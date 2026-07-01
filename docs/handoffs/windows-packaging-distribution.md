# Windows Packaging And Distribution Policy

Date: 2026-07-01
Scope: M3 from `docs/plans/windows-client-acceleration-plan.md`.

## CI Build Path

The Windows overlay build is verified by `.github/workflows/windows-overlay.yml`.

The workflow runs on `windows-latest` and performs:

- Checkout.
- Node 22 setup with the overlay package-lock cache.
- Rust stable setup through `rustup`.
- NSIS installation for the Windows installer bundle.
- `npm ci` in `overlay/`.
- `npm test` in `overlay/`.
- `npm run build` in `overlay/`.
- `cargo test` in `overlay/src-tauri/`.
- Artifact audit before packaging.
- `npm run package:windows`, currently `tauri build --bundles nsis`.
- Artifact audit after packaging.
- Upload of `overlay/src-tauri/target/release/bundle/**` as an unsigned,
  short-retention CI artifact.

The workflow is a verification path, not a release-publishing path.

## Artifact Audit

`overlay/scripts/audit-windows-artifact.mjs` is the local and CI audit gate.

It verifies:

- Synced public overlay data exists in `overlay/public/data/`.
- Built renderer public data exists in `overlay/dist/data/` when `dist/` is
  present.
- Tauri capability JSON files exist and parse.
- `tauri.conf.json` keeps the renderer bundled locally.
- Tauri updater configuration is absent.
- Artifact/staging roots do not contain `.env` files, Riot API keys, Google
  credentials, BigQuery credential markers, raw LCU payload names, raw
  screenshot names, or remote renderer JavaScript loading patterns.

The audit intentionally scans package staging roots, not the full repository.
The repository contains sanitizer fixtures and docs that mention forbidden
fields to prove privacy boundaries; those are not packaged artifacts.

## Unsigned Build Policy

Current Windows CI artifacts are unsigned. Expected behavior:

- Windows SmartScreen or corporate endpoint controls may warn or block the
  installer.
- Unsigned CI artifacts are for maintainer validation only.
- Do not publish unsigned artifacts as an end-user release.
- Keep generated installers and bundle output out of git.

Before public distribution, add:

- Code-signing certificate ownership and renewal plan.
- Secret storage rules for signing material.
- CI signing step with no local developer secrets committed.
- Installer hash recording.
- Manual smoke test on a clean Windows host.

## Update Policy

Auto-update remains disabled.

Do not enable Tauri updater or any equivalent update mechanism until there is a
separate design covering:

- Signed update artifacts.
- HTTPS feed ownership and feed integrity.
- Hash verification.
- Staged rollout controls.
- Rollback procedure.
- User-visible update status and failure handling.

The renderer must stay local to the packaged app. Do not remote-load renderer
JavaScript or use a remote web app as the packaged overlay UI.

## Distribution Matrix

Minimum pre-release matrix:

- Windows 11 standard user install.
- Windows 11 administrator install.
- Windows 10 current support install, if available.
- First launch with no League client.
- Launch while League client is running.
- Consent and collector-control windows remain bounded/focusable.
- Main overlay remains click-through by default.
- OCR diagnostics stay local.

Broader release is blocked on signing and update-feed design.
