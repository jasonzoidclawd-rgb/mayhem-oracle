//! Desktop device-authorization lifecycle.
//!
//! Rust owns the raw device credential end-to-end: it requests a short-lived
//! pairing code from the backend, polls for approval, and persists the
//! resulting bearer token in the OS-backed secure store (macOS Keychain /
//! Windows Credential Manager via the `keyring` crate). The webview only ever
//! sees the pairing code (safe to display — the user must type it into their
//! browser) and small status/lifecycle enums; it never receives the token
//! value itself. `member.rs` reads the cached token through `bearer_token()`
//! to authenticate `/api/overlay/*` requests, and calls `invalidate()` when
//! the backend reports the credential itself is invalid/revoked (as opposed
//! to merely lacking an entitlement).
//!
//! Deliberately not `Debug`/`Display`: nothing here can be accidentally
//! formatted into a log, panic message, or diagnostic event, so the token
//! never needs a redaction rule to remember.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use keyring::Entry;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "com.mayhem-oracle.overlay";
const KEYRING_ACCOUNT: &str = "device-token";

/// Abstracts the OS-backed secure credential store so the lifecycle logic
/// above it is unit-testable without a real Keychain/Credential Manager.
/// Never `Debug` — see module docs.
pub trait CredentialStore: Send + Sync {
    fn get(&self) -> Option<String>;
    /// Fails closed: an `Err` here must never be treated as a successful
    /// link. The error string must never contain `token`.
    fn set(&self, token: &str) -> Result<(), String>;
    fn delete(&self);
}

struct KeyringCredentialStore;

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|error| error.to_string())
}

impl CredentialStore for KeyringCredentialStore {
    fn get(&self) -> Option<String> {
        keyring_entry().ok()?.get_password().ok()
    }

    fn set(&self, token: &str) -> Result<(), String> {
        keyring_entry()?
            .set_password(token)
            .map_err(|error| format!("secure-store-write-failed: {error}"))
    }

    fn delete(&self) {
        if let Ok(entry) = keyring_entry() {
            let _ = entry.delete_credential();
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAuthStatus {
    pub linked: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeStarted {
    /// A short-lived pairing code — safe to display; the user types it into
    /// their browser. This is NOT the device bearer token.
    pub code: String,
    pub expires_in_seconds: u64,
    /// Identifies this linking attempt so a superseded poll (an older
    /// `device_request_code` call, or one that lost to `device_reset`) can
    /// never install a stale credential.
    pub attempt: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case", tag = "status")]
pub enum DevicePollOutcome {
    Pending,
    Approved,
    Expired,
    /// A newer attempt (or a reset) owns state now; this poll's result is
    /// discarded without touching the credential.
    Superseded,
}

struct Attempt {
    code: String,
    id: u64,
}

/// True while `attempt_id` still names the in-flight attempt. Pulled out as
/// a pure function so staleness handling is testable without any network or
/// timing involved.
fn attempt_still_current(current: Option<&Attempt>, attempt_id: u64) -> bool {
    matches!(current, Some(attempt) if attempt.id == attempt_id)
}

/// A revoked/invalid device credential (the backend's `device-token-invalid`
/// reason) must be wiped; a merely-unentitled one (403) must not be — the two
/// are different failures and only the first is this function's job to
/// detect. Pulled out as a pure function so `member.rs`'s two call sites
/// (bootstrap, game-session) share one tested decision.
pub fn should_invalidate_credential(status: u16, error_reason: &str) -> bool {
    status == 401 && error_reason == "device-token-invalid"
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeResponseBody {
    code: String,
    expires_in_seconds: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenResponseBody {
    device_token: String,
}

fn api_error(status: u16, body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value.get("error")?.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("device-auth-api-{status}"))
}

fn parse_code_response(status: u16, body: &str) -> Result<CodeResponseBody, String> {
    if status != 200 {
        return Err(api_error(status, body));
    }
    serde_json::from_str(body).map_err(|error| format!("invalid-device-code-response: {error}"))
}

enum TokenPollResponse {
    Pending,
    Issued(String),
    Rejected,
}

fn parse_token_response(status: u16, body: &str) -> Result<TokenPollResponse, String> {
    match status {
        202 => Ok(TokenPollResponse::Pending),
        200 => {
            let parsed: TokenResponseBody = serde_json::from_str(body)
                .map_err(|error| format!("invalid-device-token-response: {error}"))?;
            Ok(TokenPollResponse::Issued(parsed.device_token))
        }
        400 => Ok(TokenPollResponse::Rejected),
        _ => Err(api_error(status, body)),
    }
}

pub fn platform_label() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else {
        "macos"
    }
}

pub struct DeviceAuthState {
    client: Client,
    api_base: Url,
    store: Box<dyn CredentialStore>,
    token: Mutex<Option<String>>,
    attempt: Mutex<Option<Attempt>>,
    next_attempt_id: AtomicU64,
}

impl DeviceAuthState {
    pub fn new(api_base: Url) -> Result<Self, String> {
        Self::new_with_store(api_base, Box::new(KeyringCredentialStore))
    }

    pub fn new_with_store(api_base: Url, store: Box<dyn CredentialStore>) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|error| error.to_string())?;
        let token = Mutex::new(store.get());
        Ok(Self {
            client,
            api_base,
            store,
            token,
            attempt: Mutex::new(None),
            next_attempt_id: AtomicU64::new(1),
        })
    }

    /// The current bearer token, if this device is linked. Never logged,
    /// never returned from a Tauri command — only consumed directly by
    /// `member.rs` to attach `Authorization: Bearer <token>`.
    pub fn bearer_token(&self) -> Option<String> {
        self.token.lock().ok()?.clone()
    }

    pub fn status(&self) -> DeviceAuthStatus {
        DeviceAuthStatus {
            linked: self.bearer_token().is_some(),
        }
    }

    fn endpoint(&self, path: &str) -> Result<Url, String> {
        self.api_base.join(path).map_err(|error| error.to_string())
    }

    pub async fn request_code(&self) -> Result<DeviceCodeStarted, String> {
        let response = self
            .client
            .post(self.endpoint("/api/device/code")?)
            .json(&serde_json::json!({ "platform": platform_label() }))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|error| error.to_string())?;
        let parsed = parse_code_response(status, &body)?;

        let id = self.next_attempt_id.fetch_add(1, Ordering::SeqCst);
        {
            let mut attempt = self
                .attempt
                .lock()
                .map_err(|_| "device attempt mutex poisoned".to_string())?;
            *attempt = Some(Attempt {
                code: parsed.code.clone(),
                id,
            });
        }
        Ok(DeviceCodeStarted {
            code: parsed.code,
            expires_in_seconds: parsed.expires_in_seconds,
            attempt: id,
        })
    }

    pub async fn poll(&self, attempt_id: u64) -> Result<DevicePollOutcome, String> {
        let code = {
            let guard = self
                .attempt
                .lock()
                .map_err(|_| "device attempt mutex poisoned".to_string())?;
            if !attempt_still_current(guard.as_ref(), attempt_id) {
                return Ok(DevicePollOutcome::Superseded);
            }
            guard.as_ref().expect("checked current above").code.clone()
        };

        let response = self
            .client
            .post(self.endpoint("/api/device/token")?)
            .json(&serde_json::json!({ "code": code }))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|error| error.to_string())?;
        let outcome = parse_token_response(status, &body)?;

        match outcome {
            TokenPollResponse::Pending => Ok(DevicePollOutcome::Pending),
            TokenPollResponse::Issued(token) => self.commit_approved_token(attempt_id, token),
            TokenPollResponse::Rejected => {
                // Unknown/expired code. Only clear the attempt if it's still
                // this one — a superseded attempt's rejection must not clear
                // a newer attempt that has since taken over.
                if let Ok(mut attempt) = self.attempt.lock() {
                    if attempt_still_current(attempt.as_ref(), attempt_id) {
                        *attempt = None;
                    }
                }
                Ok(DevicePollOutcome::Expired)
            }
        }
    }

    fn install_token(&self, token: String) -> Result<(), String> {
        // Durable write first — fail closed. A secure-store failure must
        // never leave an in-memory-only credential that looks linked now but
        // silently isn't after restart.
        self.store.set(&token)?;
        let mut guard = self
            .token
            .lock()
            .map_err(|_| "device token mutex poisoned".to_string())?;
        *guard = Some(token);
        Ok(())
    }

    /// Commits an approved poll's token if, and only if, `attempt_id` still
    /// owns the in-flight attempt. Holds the attempt lock across the whole
    /// check-install-clear sequence so it is one atomic transaction: a
    /// concurrent `invalidate()` or a newer `request_code()` (both of which
    /// take this same lock) can never land between "we still own this
    /// attempt" and "the token is durably written". Either the commit
    /// happens entirely before the other operation, or entirely after —
    /// there is no window in which a reset can be silently overwritten by a
    /// stale install, or a newer attempt's slot can be clobbered back to
    /// `None` by an older one's cleanup.
    fn commit_approved_token(&self, attempt_id: u64, token: String) -> Result<DevicePollOutcome, String> {
        let mut guard = self
            .attempt
            .lock()
            .map_err(|_| "device attempt mutex poisoned".to_string())?;
        if !attempt_still_current(guard.as_ref(), attempt_id) {
            return Ok(DevicePollOutcome::Superseded);
        }
        self.install_token(token)?;
        *guard = None;
        Ok(DevicePollOutcome::Approved)
    }

    /// Wipe a revoked/invalid credential and drop any in-flight linking
    /// attempt (so a stale poll can never reinstall it). Also used directly
    /// as the user-triggered "unlink this device" action. Takes the attempt
    /// lock first and holds it for the whole wipe, for the same reason
    /// `commit_approved_token` does: it must not be possible for a
    /// concurrent poll's commit to interleave between clearing the store and
    /// clearing the attempt, which would leave a just-reset device holding a
    /// stale credential again.
    pub fn invalidate(&self) {
        // A revoke must always run even if some earlier critical section
        // panicked and poisoned this lock — recover it rather than skip the
        // wipe.
        let mut guard = self.attempt.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        self.store.delete();
        if let Ok(mut token) = self.token.lock() {
            *token = None;
        }
        *guard = None;
    }
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn device_auth_status(state: tauri::State<'_, std::sync::Arc<DeviceAuthState>>) -> DeviceAuthStatus {
    state.status()
}

#[tauri::command]
pub async fn device_request_code(
    state: tauri::State<'_, std::sync::Arc<DeviceAuthState>>,
) -> Result<DeviceCodeStarted, String> {
    state.request_code().await
}

#[tauri::command]
pub async fn device_poll(
    state: tauri::State<'_, std::sync::Arc<DeviceAuthState>>,
    attempt: u64,
) -> Result<DevicePollOutcome, String> {
    state.poll(attempt).await
}

#[tauri::command]
pub fn device_reset(state: tauri::State<'_, std::sync::Arc<DeviceAuthState>>) {
    state.invalidate();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::mpsc;
    use std::time::Duration;

    /// A credential store whose `set()` blocks mid-write until told to
    /// proceed, and announces the moment it starts blocking. Lets a test
    /// deterministically land a second operation while a commit is holding
    /// the attempt lock, instead of racing real threads against a sleep.
    struct BlockingCredentialStore {
        entered_tx: Mutex<mpsc::Sender<()>>,
        proceed_rx: Mutex<mpsc::Receiver<()>>,
        value: Mutex<Option<String>>,
    }

    impl BlockingCredentialStore {
        fn new() -> (Self, mpsc::Receiver<()>, mpsc::Sender<()>) {
            let (entered_tx, entered_rx) = mpsc::channel();
            let (proceed_tx, proceed_rx) = mpsc::channel();
            (
                Self {
                    entered_tx: Mutex::new(entered_tx),
                    proceed_rx: Mutex::new(proceed_rx),
                    value: Mutex::new(None),
                },
                entered_rx,
                proceed_tx,
            )
        }
    }

    impl CredentialStore for BlockingCredentialStore {
        fn get(&self) -> Option<String> {
            self.value.lock().unwrap().clone()
        }

        fn set(&self, token: &str) -> Result<(), String> {
            self.entered_tx.lock().unwrap().send(()).ok();
            self.proceed_rx
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .expect("test proceed signal never arrived");
            *self.value.lock().unwrap() = Some(token.to_string());
            Ok(())
        }

        fn delete(&self) {
            *self.value.lock().unwrap() = None;
        }
    }

    #[derive(Default)]
    struct FakeCredentialStore {
        value: Mutex<Option<String>>,
        fail_writes: AtomicBool,
        deleted: AtomicBool,
    }

    impl FakeCredentialStore {
        fn empty() -> Self {
            Self::default()
        }

        fn prefilled(token: &str) -> Self {
            Self {
                value: Mutex::new(Some(token.to_string())),
                ..Self::default()
            }
        }

        fn failing() -> Self {
            Self {
                fail_writes: AtomicBool::new(true),
                ..Self::default()
            }
        }
    }

    impl CredentialStore for FakeCredentialStore {
        fn get(&self) -> Option<String> {
            self.value.lock().unwrap().clone()
        }

        fn set(&self, token: &str) -> Result<(), String> {
            if self.fail_writes.load(Ordering::SeqCst) {
                return Err("fake-store-write-failure".to_string());
            }
            *self.value.lock().unwrap() = Some(token.to_string());
            Ok(())
        }

        fn delete(&self) {
            self.deleted.store(true, Ordering::SeqCst);
            *self.value.lock().unwrap() = None;
        }
    }

    fn test_api_base() -> Url {
        Url::parse("http://127.0.0.1:0").unwrap()
    }

    fn state_with(store: FakeCredentialStore) -> DeviceAuthState {
        DeviceAuthState::new_with_store(test_api_base(), Box::new(store)).unwrap()
    }

    // ── fresh install / restart reuse ───────────────────────────────────────

    #[test]
    fn a_fresh_install_with_no_stored_credential_starts_unlinked() {
        let state = state_with(FakeCredentialStore::empty());
        assert_eq!(state.status(), DeviceAuthStatus { linked: false });
        assert_eq!(state.bearer_token(), None);
    }

    #[test]
    fn a_previously_linked_device_reuses_its_credential_after_restart() {
        let state = state_with(FakeCredentialStore::prefilled("stored-token"));
        assert_eq!(state.status(), DeviceAuthStatus { linked: true });
        assert_eq!(state.bearer_token(), Some("stored-token".to_string()));
    }

    // ── install / fail-closed ───────────────────────────────────────────────

    #[test]
    fn installing_a_token_persists_it_and_makes_it_the_active_bearer_token() {
        let state = state_with(FakeCredentialStore::empty());
        state.install_token("new-token".to_string()).unwrap();
        assert_eq!(state.bearer_token(), Some("new-token".to_string()));
        assert_eq!(state.status(), DeviceAuthStatus { linked: true });
    }

    #[test]
    fn a_secure_store_write_failure_never_installs_a_durable_or_in_memory_credential() {
        let state = state_with(FakeCredentialStore::failing());
        let result = state.install_token("would-be-token".to_string());
        assert!(result.is_err());
        assert_eq!(state.bearer_token(), None, "no false durable auth on store failure");
        assert_eq!(state.status(), DeviceAuthStatus { linked: false });
    }

    #[test]
    fn a_secure_store_write_failure_never_leaks_the_token_into_its_error_message() {
        let state = state_with(FakeCredentialStore::failing());
        let error = state
            .install_token("super-secret-token-value".to_string())
            .unwrap_err();
        assert!(!error.contains("super-secret-token-value"));
    }

    // ── invalidate / reset ──────────────────────────────────────────────────

    #[test]
    fn invalidate_wipes_the_stored_and_in_memory_credential() {
        let state = state_with(FakeCredentialStore::prefilled("stored-token"));
        state.invalidate();
        assert_eq!(state.bearer_token(), None);
        assert_eq!(state.status(), DeviceAuthStatus { linked: false });
    }

    #[test]
    fn invalidate_clears_an_in_flight_attempt_so_a_late_poll_cannot_reinstall_a_credential() {
        let state = state_with(FakeCredentialStore::empty());
        {
            let mut attempt = state.attempt.lock().unwrap();
            *attempt = Some(Attempt { code: "ABCD".to_string(), id: 1 });
        }
        state.invalidate();
        let guard = state.attempt.lock().unwrap();
        assert!(guard.is_none());
    }

    // ── attempt staleness (pure function) ───────────────────────────────────

    #[test]
    fn a_poll_for_the_current_attempt_is_current() {
        let attempt = Attempt { code: "ABCD".to_string(), id: 7 };
        assert!(attempt_still_current(Some(&attempt), 7));
    }

    #[test]
    fn a_poll_for_a_superseded_attempt_id_is_not_current() {
        let attempt = Attempt { code: "ABCD".to_string(), id: 8 };
        assert!(!attempt_still_current(Some(&attempt), 7));
    }

    #[test]
    fn a_poll_with_no_in_flight_attempt_at_all_is_not_current() {
        assert!(!attempt_still_current(None, 7));
    }

    // ── should_invalidate_credential (pure function) ────────────────────────

    #[test]
    fn an_invalid_or_revoked_device_token_must_be_wiped() {
        assert!(should_invalidate_credential(401, "device-token-invalid"));
    }

    #[test]
    fn a_missing_cookie_session_unauthenticated_reason_must_not_wipe_anything() {
        // The bearer path never produces this reason (see member.rs), but the
        // decision function itself must still refuse it defensively.
        assert!(!should_invalidate_credential(401, "unauthenticated"));
    }

    #[test]
    fn an_entitlement_denial_must_never_be_treated_as_a_bypass_or_a_revocation() {
        assert!(!should_invalidate_credential(403, "none"));
        assert!(!should_invalidate_credential(403, "lookup-failed"));
    }

    // ── HTTP response parsing (pure functions) ──────────────────────────────

    #[test]
    fn parses_a_successful_code_response() {
        let parsed = parse_code_response(200, r#"{"code":"WXYZ-1234","expiresInSeconds":600}"#)
            .unwrap();
        assert_eq!(parsed.code, "WXYZ-1234");
        assert_eq!(parsed.expires_in_seconds, 600);
    }

    #[test]
    fn a_non_200_code_response_surfaces_the_backend_error_reason() {
        let error = parse_code_response(500, r#"{"error":"boom"}"#).unwrap_err();
        assert_eq!(error, "boom");
    }

    #[test]
    fn a_202_token_poll_response_is_pending() {
        assert!(matches!(
            parse_token_response(202, r#"{"status":"pending"}"#).unwrap(),
            TokenPollResponse::Pending
        ));
    }

    #[test]
    fn a_200_token_poll_response_carries_the_issued_token() {
        match parse_token_response(200, r#"{"deviceToken":"issued-token"}"#).unwrap() {
            TokenPollResponse::Issued(token) => assert_eq!(token, "issued-token"),
            _ => panic!("expected Issued"),
        }
    }

    #[test]
    fn a_400_token_poll_response_is_rejected_unknown_or_expired() {
        assert!(matches!(
            parse_token_response(400, r#"{"error":"invalid or expired code"}"#).unwrap(),
            TokenPollResponse::Rejected
        ));
    }

    #[test]
    fn an_unexpected_status_is_a_hard_error_not_a_silent_pending() {
        assert!(parse_token_response(500, r#"{"error":"boom"}"#).is_err());
    }

    // ── commit/reset/newer-attempt linearizability (real thread interleaving) ─

    #[test]
    fn a_reset_that_arrives_while_an_approval_is_mid_commit_still_wins_once_it_runs() {
        let (store, entered_rx, proceed_tx) = BlockingCredentialStore::new();
        let state = std::sync::Arc::new(
            DeviceAuthState::new_with_store(test_api_base(), Box::new(store)).unwrap(),
        );
        {
            let mut attempt = state.attempt.lock().unwrap();
            *attempt = Some(Attempt { code: "ABCD".to_string(), id: 1 });
        }

        let committer = {
            let state = state.clone();
            std::thread::spawn(move || state.commit_approved_token(1, "stale-token".to_string()))
        };

        // Block until the committer is inside store.set(), i.e. it has
        // already passed its ownership check and is holding the attempt
        // lock for the rest of its critical section.
        entered_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("commit never entered the store write");

        // A reset requested while that commit is mid-flight must block on
        // the same lock rather than racing it -- spawn it now and let both
        // finish, then check who actually won.
        let resetter = {
            let state = state.clone();
            std::thread::spawn(move || state.invalidate())
        };

        proceed_tx.send(()).unwrap();
        let outcome = committer.join().unwrap().unwrap();
        resetter.join().unwrap();

        assert_eq!(
            outcome,
            DevicePollOutcome::Approved,
            "the attempt still owned its slot when the commit's check ran"
        );
        assert_eq!(
            state.bearer_token(),
            None,
            "the reset ran after the commit finished and must still wipe the just-installed token"
        );
        assert!(state.attempt.lock().unwrap().is_none());
    }

    #[test]
    fn a_newer_attempt_that_starts_while_an_older_installs_is_never_clobbered_back_to_none() {
        let (store, entered_rx, proceed_tx) = BlockingCredentialStore::new();
        let state = std::sync::Arc::new(
            DeviceAuthState::new_with_store(test_api_base(), Box::new(store)).unwrap(),
        );
        {
            let mut attempt = state.attempt.lock().unwrap();
            *attempt = Some(Attempt { code: "ABCD".to_string(), id: 1 });
        }

        let committer = {
            let state = state.clone();
            std::thread::spawn(move || state.commit_approved_token(1, "attempt-1-token".to_string()))
        };

        entered_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("commit never entered the store write");

        // A newer attempt (as request_code() would install) starting while
        // attempt 1's commit is mid-flight must block on the same lock, not
        // get silently wiped back to None by attempt 1's post-install
        // cleanup once that commit finally proceeds.
        let new_attempt_starter = {
            let state = state.clone();
            std::thread::spawn(move || {
                let mut attempt = state.attempt.lock().unwrap();
                *attempt = Some(Attempt { code: "NEWC".to_string(), id: 2 });
            })
        };

        proceed_tx.send(()).unwrap();
        committer.join().unwrap().unwrap();
        new_attempt_starter.join().unwrap();

        let guard = state.attempt.lock().unwrap();
        assert!(
            attempt_still_current(guard.as_ref(), 2),
            "attempt 2 must still own the slot, not be clobbered back to None by attempt 1's cleanup"
        );
    }
}
