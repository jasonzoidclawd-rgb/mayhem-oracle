"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { safeNextPath } from "@/lib/auth/redirects";
import {
  GOOGLE_IDENTITY_SCRIPT_SRC,
  getGoogleClientId,
  normalizeGoogleSignInNextPath,
  signInWithGoogleCredential,
  type GoogleCredentialResponse,
} from "@/lib/auth/google-identity";
import { createClient } from "@/lib/supabase/client";

type GoogleSignInButtonProps = {
  next: string;
  label: string;
  size?: "large" | "medium";
};

function googleUnavailableMessage(): string {
  if (process.env.NODE_ENV === "development") {
    return "Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign-in.";
  }
  return "Google sign-in is unavailable.";
}

function authErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Google sign-in failed";
}

export function GoogleSignInButton({
  next,
  label,
  size = "large",
}: GoogleSignInButtonProps) {
  const router = useRouter();
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clientId = getGoogleClientId({
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  });
  const nextPath = normalizeGoogleSignInNextPath(safeNextPath(next));

  const handleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      setBusy(true);
      setMessage(null);

      try {
        const supabase = createClient();
        await signInWithGoogleCredential(supabase, response);
        router.push(nextPath);
        router.refresh();
      } catch (error) {
        setMessage(authErrorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [nextPath, router],
  );

  const renderGoogleButton = useCallback(() => {
    if (!clientId || !scriptReady || !buttonRef.current || !window.google?.accounts.id) {
      return;
    }

    buttonRef.current.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredential,
      ux_mode: "popup",
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.renderButton(buttonRef.current, {
      type: "standard",
      theme: "outline",
      size,
      text: "signin_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: size === "large" ? 260 : 220,
    });
  }, [clientId, handleCredential, scriptReady, size]);

  useEffect(() => {
    renderGoogleButton();
  }, [renderGoogleButton]);

  const unavailable = clientId ? null : googleUnavailableMessage();

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <Script
        src={GOOGLE_IDENTITY_SCRIPT_SRC}
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setMessage("Google sign-in is unavailable.")}
      />
      {clientId ? (
        <div ref={buttonRef} aria-label={label} aria-busy={busy} />
      ) : (
        <button
          type="button"
          disabled
          className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/40"
        >
          {label}
        </button>
      )}
      {busy ? <p className="text-xs text-white/50">Signing in...</p> : null}
      {unavailable || message ? (
        <p role="alert" className="max-w-xs text-center text-xs text-rose-300">
          {unavailable || message}
        </p>
      ) : null}
    </div>
  );
}
