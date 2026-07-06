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
