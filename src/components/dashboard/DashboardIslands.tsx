"use client";

import { useEffect } from "react";

// Wires the reveal-on-scroll behavior for the server-rendered dashboard
// widgets below: each carries a `.reveal` class with no visible markup of
// its own. Setting data-reveal-ready gates the CSS in globals.css so
// content stays visible if JS never runs (slow connection, JS disabled).
export function DashboardIslands() {
  useEffect(() => {
    document.documentElement.setAttribute("data-reveal-ready", "");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    const elements = document.querySelectorAll<HTMLElement>(".reveal");
    elements.forEach((el, i) => {
      el.style.animationDelay = `${Math.min(i, 6) * 60}ms`;
      io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  return null;
}
