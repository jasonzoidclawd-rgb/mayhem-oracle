"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const DISMISS_KEY = "mo_rotate_hint_dismissed";

export function RotateHint() {
  const t = useTranslations("dashboard");
  const [show, setShow] = useState(false);

  useEffect(() => {
    const dismissed = () => {
      try {
        return !!localStorage.getItem(DISMISS_KEY);
      } catch {
        return false;
      }
    };
    const mq = window.matchMedia("(orientation: portrait) and (max-width: 767px)");
    const sync = () => setShow(!dismissed() && mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // localStorage unavailable (e.g. private browsing) — hint just won't persist dismissal
    }
    setShow(false);
  };

  return (
    <div
      role="status"
      className="col-span-full flex items-center gap-2.5 rounded-xl border border-[var(--color-border-default)]
                 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.01))]
                 px-3.5 py-2.5 text-[12.5px] text-[var(--color-text-secondary)]"
    >
      <span className="text-base" aria-hidden="true">📱</span>
      <span>{t("rotateHint")}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("dismiss")}
        className="ml-auto flex h-11 w-11 items-center justify-center text-lg leading-none text-[var(--color-text-muted)]"
      >
        ×
      </button>
    </div>
  );
}
