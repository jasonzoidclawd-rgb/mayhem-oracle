"use client";

import { useState } from "react";

interface RedeemCopy {
  redeemTitle: string;
  redeemPlaceholder: string;
  redeemButton: string;
  redeemSuccess: string;
  redeemError: string;
  redeemInvalidExpired: string;
}

const LOCALIZED_REDEEM_ERRORS = [
  "invalid invite code",
  "invite code expired",
  "invite code exhausted",
  "invite code revoked",
  "invite already redeemed",
];

export function redeemFailureMessage(error: string | undefined, copy: RedeemCopy): string {
  if (error && LOCALIZED_REDEEM_ERRORS.some((known) => error.includes(known))) {
    return copy.redeemInvalidExpired;
  }
  return copy.redeemError;
}

export function RedeemForm({ copy }: { copy: RedeemCopy }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (code.trim().length < 6) return;
    setState("pending");
    setMessage("");
    try {
      const response = await fetch("/api/invites/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (response.ok) {
        setState("ok");
        setMessage(copy.redeemSuccess);
        setCode("");
        // Reflect the new entitlement in server components.
        setTimeout(() => window.location.reload(), 800);
      } else {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setState("error");
        setMessage(redeemFailureMessage(body.error, copy));
      }
    } catch {
      setState("error");
      setMessage(copy.redeemError);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{copy.redeemTitle}</h2>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder={copy.redeemPlaceholder}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 rounded-lg border border-white/15 bg-black/30 px-4 py-3 font-mono tracking-wider outline-none focus:border-amber-400/60"
        />
        <button
          type="submit"
          disabled={state === "pending" || code.trim().length < 6}
          className="rounded-lg bg-amber-400/90 px-5 py-3 font-semibold text-black transition hover:bg-amber-300 disabled:opacity-40"
        >
          {copy.redeemButton}
        </button>
      </div>
      {message ? (
        <p
          role="status"
          className={state === "error" ? "text-sm text-rose-300" : "text-sm text-emerald-300"}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}

interface LinkDeviceCopy {
  linkDeviceTitle: string;
  linkDeviceHelp: string;
  linkDevicePlaceholder: string;
  linkDeviceButton: string;
  linkDeviceSuccess: string;
  linkDeviceError: string;
  linkDeviceInvalidExpired: string;
}

const LOCALIZED_LINK_DEVICE_ERRORS = ["invalid or expired code"];

export function linkDeviceFailureMessage(error: string | undefined, copy: LinkDeviceCopy): string {
  if (error && LOCALIZED_LINK_DEVICE_ERRORS.some((known) => error.includes(known))) {
    return copy.linkDeviceInvalidExpired;
  }
  return copy.linkDeviceError;
}

/**
 * Approves a device code shown by the desktop overlay. This call mints the
 * device token server-side, but the token itself is only ever handed back to
 * the desktop process (via its own poll) — this form never reads or stores
 * it, it only reports success/failure.
 */
export function LinkDeviceForm({
  copy,
  initialCode = "",
}: {
  copy: LinkDeviceCopy;
  initialCode?: string;
}) {
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (code.trim().length < 4) return;
    setState("pending");
    setMessage("");
    try {
      const response = await fetch("/api/device/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (response.ok) {
        setState("ok");
        setMessage(copy.linkDeviceSuccess);
        setCode("");
      } else {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setState("error");
        setMessage(linkDeviceFailureMessage(body.error, copy));
      }
    } catch {
      setState("error");
      setMessage(copy.linkDeviceError);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{copy.linkDeviceTitle}</h2>
      <p className="text-sm text-white/60">{copy.linkDeviceHelp}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder={copy.linkDevicePlaceholder}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 rounded-lg border border-white/15 bg-black/30 px-4 py-3 font-mono tracking-wider outline-none focus:border-amber-400/60"
        />
        <button
          type="submit"
          disabled={state === "pending" || code.trim().length < 4}
          className="rounded-lg bg-amber-400/90 px-5 py-3 font-semibold text-black transition hover:bg-amber-300 disabled:opacity-40"
        >
          {copy.linkDeviceButton}
        </button>
      </div>
      {message ? (
        <p
          role="status"
          className={state === "error" ? "text-sm text-rose-300" : "text-sm text-emerald-300"}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
