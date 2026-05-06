"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function NavigationProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const prevPathname = useRef(pathname);
  const doneTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Detect any internal link click → start the bar
  useEffect(() => {
    const onCapture = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      // Skip external links, hash-only links, and same page
      if (!href || href.startsWith("http") || href.startsWith("#")) return;
      setState("loading");
    };
    document.addEventListener("click", onCapture, true);
    return () => document.removeEventListener("click", onCapture, true);
  }, []);

  // When pathname actually changes → complete the bar
  useEffect(() => {
    if (pathname !== prevPathname.current) {
      prevPathname.current = pathname;
      clearTimeout(doneTimer.current);
      // Defer state update out of the effect body to avoid cascading renders
      const t = setTimeout(() => {
        setState("done");
        doneTimer.current = setTimeout(() => setState("idle"), 400);
      }, 0);
      return () => clearTimeout(t);
    }
    return () => clearTimeout(doneTimer.current);
  }, [pathname]);

  if (state === "idle") return null;

  return (
    <div
      aria-hidden
      className={`fixed top-0 left-0 z-[9999] h-[2px] bg-[var(--color-neon-primary)] transition-all ${
        state === "loading"
          ? "w-[70%] duration-[3000ms] ease-out"
          : "w-full duration-150 ease-in"
      }`}
      style={
        state === "done"
          ? { opacity: 0, transition: "width 150ms ease-in, opacity 250ms 150ms" }
          : undefined
      }
    />
  );
}
