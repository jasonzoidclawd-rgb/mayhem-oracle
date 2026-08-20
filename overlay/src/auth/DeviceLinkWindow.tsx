import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeCurrentWindow,
  closeWindow,
  DEVICE_LINK_WINDOW_LABEL,
  openDeviceLinkWindow,
} from "../collector/collectorWindows";
import {
  cancelDeviceLink,
  getDeviceAuthStatus,
  pollDeviceLink,
  requestDeviceCode,
  resetDeviceAuth,
  startDeviceLink,
  UNAUTHENTICATED_DEVICE_LINK_STATE,
  type DeviceAuthStatus,
  type DeviceLinkState,
} from "./deviceAuth";

const STATUS_POLL_MS = 5_000;

/**
 * Whether this device holds a linked credential. Polled independently of the
 * link window (which only exists while actively linking/unlinking) so any
 * always-visible status indicator (e.g. in the collector-controls window)
 * stays current after a link/unlink completes in the other window.
 */
export function useDeviceAuthStatus() {
  const [status, setStatus] = useState<DeviceAuthStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getDeviceAuthStatus());
    } catch {
      // Leave the previous status displayed; this is a read-only poll.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await getDeviceAuthStatus();
        if (!cancelled) setStatus(next);
      } catch {
        // Leave the previous status displayed; this is a read-only poll.
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { status, refresh };
}

interface DeviceLinkStatusRowProps {
  status: DeviceAuthStatus | null;
  onUnlinked: () => void;
}

/** Small embeddable row for the always-open collector-controls window. */
export function DeviceLinkStatusRow({ status, onUnlinked }: DeviceLinkStatusRowProps) {
  const [unlinking, setUnlinking] = useState(false);

  if (!status) return null;

  if (status.linked) {
    return (
      <div className="device-link-row">
        <span>Member device linked</span>
        <button
          disabled={unlinking}
          onClick={() => {
            setUnlinking(true);
            void resetDeviceAuth().finally(() => {
              setUnlinking(false);
              onUnlinked();
            });
          }}
        >
          Unlink
        </button>
      </div>
    );
  }

  return (
    <div className="device-link-row">
      <span>Member device not linked</span>
      <button onClick={() => void openDeviceLinkWindow()}>Link Device</button>
    </div>
  );
}

function secondsRemaining(state: DeviceLinkState, nowMs: number): number {
  if (state.stage !== "pending-approval") return 0;
  return Math.max(0, Math.ceil((state.expiresAtMs - nowMs) / 1000));
}

export function DeviceLinkWindow() {
  const [state, setState] = useState<DeviceLinkState>(UNAUTHENTICATED_DEVICE_LINK_STATE);
  const [nowMs, setNowMs] = useState(() => performance.now());
  const generationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void getDeviceAuthStatus().then((status) => {
      if (!cancelled && status.linked) setState({ stage: "linked" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.stage !== "pending-approval") return;
    const interval = setInterval(() => setNowMs(performance.now()), 500);
    return () => clearInterval(interval);
  }, [state.stage]);

  const start = useCallback(() => {
    const generation = ++generationRef.current;
    void startDeviceLink({
      requestCode: requestDeviceCode,
      poll: pollDeviceLink,
      now: () => performance.now(),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      setState: (next) => {
        // Ignore a stale attempt's callbacks once a newer one has started
        // (e.g. the user clicked "Start over" mid-poll).
        if (generationRef.current === generation) setState(next);
      },
    });
  }, []);

  const cancel = useCallback(() => {
    generationRef.current += 1; // supersede any in-flight poll's setState calls
    void cancelDeviceLink({ reset: resetDeviceAuth, setState });
  }, []);

  return (
    <main className="device-link-window-root">
      <h1>Link this device</h1>
      {state.stage === "unauthenticated" && (
        <>
          <p>Link this desktop app to your wasfun.lol account to unlock member coaching.</p>
          <button onClick={start}>Start</button>
          <button className="secondary" onClick={() => void closeWindow(DEVICE_LINK_WINDOW_LABEL)}>
            Cancel
          </button>
        </>
      )}
      {state.stage === "requesting-code" && <p>Requesting a code…</p>}
      {state.stage === "pending-approval" && (
        <>
          <p>Enter this code at wasfun.lol/account:</p>
          <p className="device-link-code">{state.code}</p>
          <p>Expires in {secondsRemaining(state, nowMs)}s</p>
          <button className="secondary" onClick={cancel}>
            Cancel
          </button>
        </>
      )}
      {state.stage === "linked" && (
        <>
          <p>Device linked.</p>
          <button onClick={() => void closeCurrentWindow()}>Close</button>
        </>
      )}
      {state.stage === "error" && (
        <>
          <p className="device-link-error">{state.message}</p>
          <button onClick={start}>Try again</button>
          <button className="secondary" onClick={() => void closeWindow(DEVICE_LINK_WINDOW_LABEL)}>
            Cancel
          </button>
        </>
      )}
    </main>
  );
}
