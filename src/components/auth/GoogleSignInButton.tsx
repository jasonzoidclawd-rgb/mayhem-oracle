"use client";

import Script from "next/script";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { safeNextPath } from "@/lib/auth/redirects";
import {
  GOOGLE_IDENTITY_SCRIPT_SRC,
  generateGoogleNonce,
  getGoogleClientId,
  normalizeGoogleSignInNextPath,
  signInWithGoogleCredential,
  type GoogleCredentialResponse,
  type GoogleNoncePair,
} from "@/lib/auth/google-identity";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";

type GoogleSignInButtonProps = {
  next: string;
  label: string;
  size?: "large" | "medium";
};

export function GoogleSignInButton({
  next,
  label,
  size = "large",
}: GoogleSignInButtonProps) {
  const t = useTranslations("auth");
  const router = useRouter();
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noncePair, setNoncePair] = useState<GoogleNoncePair | "unsupported" | null>(null);
  const clientId = getGoogleClientId({
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  });
  const nextPath = normalizeGoogleSignInNextPath(safeNextPath(next));

  useEffect(() => {
    let cancelled = false;
    void generateGoogleNonce().then((pair) => {
      if (!cancelled) setNoncePair(pair ?? "unsupported");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      setBusy(true);
      setMessage(null);
      track("signup_start");

      try {
        const supabase = createClient();
        await signInWithGoogleCredential(
          supabase,
          response,
          noncePair && noncePair !== "unsupported" ? { nonce: noncePair.nonce } : {},
        );
        track("signup_complete");
        router.push(nextPath);
        router.refresh();
      } catch (error) {
        // Raw provider errors go to the console only; the UI shows a known
        // localized failure bucket (mirrors the auth-errors known-code rule).
        console.error("google-signin:", error);
        setMessage(t("signIn.failed"));
      } finally {
        setBusy(false);
      }
    },
    [nextPath, noncePair, router, t],
  );

  const renderGoogleButton = useCallback(() => {
    if (!clientId || !scriptReady || !buttonRef.current || !window.google?.accounts.id) {
      return;
    }
    if (noncePair === null) {
      return;
    }

    buttonRef.current.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredential,
      ux_mode: "popup",
      auto_select: false,
      cancel_on_tap_outside: true,
      ...(noncePair !== "unsupported" ? { nonce: noncePair.hashedNonce } : {}),
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
  }, [clientId, handleCredential, noncePair, scriptReady, size]);

  useEffect(() => {
    renderGoogleButton();
  }, [renderGoogleButton]);

  const unavailable = clientId ? null : t("signIn.unavailable");

  useEffect(() => {
    if (!clientId && process.env.NODE_ENV === "development") {
      console.warn("Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign-in.");
    }
  }, [clientId]);

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <Script
        src={GOOGLE_IDENTITY_SCRIPT_SRC}
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setMessage(t("signIn.unavailable"))}
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
      {busy ? <p className="text-xs text-white/50">{t("signIn.busy")}</p> : null}
      {unavailable || message ? (
        <p role="alert" className="max-w-xs text-center text-xs text-rose-300">
          {unavailable || message}
        </p>
      ) : null}
    </div>
  );
}
