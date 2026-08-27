-- Desktop device-token exchange (overlay-device-auth fix).
--
-- The browser-side /api/device/link approval mints a device token, but the
-- desktop process that displayed the code has no session to receive it back
-- directly. It must poll for the token using only the code it already knows.
-- Store the freshly minted token on the claimed code row, transiently: the
-- exchange endpoint deletes the row atomically on first successful retrieval
-- (see exchangeDeviceCode in src/lib/api/telemetry-deps.ts), so the plaintext
-- token never persists past a single poll cycle and is bounded by the code's
-- existing short expiry even if no poll ever arrives.
alter table public.device_codes
  add column if not exists pending_device_token text;
