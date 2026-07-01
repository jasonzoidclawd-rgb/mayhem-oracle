# Windows OCR Fixture Policy

Date: 2026-07-01
Scope: M2 from `docs/plans/windows-client-acceleration-plan.md`.

## Fixture Boundary

OCR fixtures are local development artifacts for regression tests only.

Allowed in git:

- Cropped augment-card title regions.
- Sanitized synthetic images that contain only augment-card text.
- JSON manifests that list expected card slot order, OCR text, confidence, and
  fixture provenance.

Not allowed in git:

- Full screenshots.
- League window captures with player names, chat, minimap, scoreboard, friends
  list, or account UI.
- Riot IDs, PUUIDs, summoner names, chat, raw LCU payloads, API keys, or device
  tokens.
- Unsanitized diagnostics from a live player session.

## Diagnostics

OCR diagnostics must remain local-only. Temporary image crops created for
Tesseract may be written to the OS temp directory only long enough for local OCR
execution and must not be uploaded by the collector or committed as fixtures.

If a future debug mode saves OCR samples, it must write to an explicit local
diagnostics directory, default off, with a visible user action and a review step
before anything enters git.

## Lifecycle Gate

The overlay may run augment OCR only when normalized LCU gameflow state reports
live capture is allowed. Leaving the live game phase must stop OCR, clear stale
matched cards, reset round capture state, and hide advisor output.

The collector status panel remains diagnostic. It must not become the gameplay
advisor UI.

## Manual Windows Checklist

Before promoting Windows OCR changes beyond local development:

- Alt-Tab works while the overlay is running.
- League remains focusable.
- The main transparent overlay stays click-through by default.
- Consent is in a bounded focusable window.
- Collector controls are bounded and require explicit interaction.
- OCR runs only in live game phase.
- OCR debug artifacts, if any, stay local and sanitized.
