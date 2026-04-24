"use client";

import { useState, useRef, useLayoutEffect } from "react";

type Side = "top" | "bottom";
type Align = "left" | "center" | "right";

export function Tooltip({
  content,
  children,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<Side>("top");
  const [align, setAlign] = useState<Align>("center");
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Recompute position whenever tooltip opens.
  // useLayoutEffect is correct here: we measure DOM geometry synchronously after paint.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const vpW = window.innerWidth;
    const TOOLTIP_H = 140; // estimated max tooltip height
    const TOOLTIP_W = 256; // w-64

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSide(rect.top < TOOLTIP_H + 8 ? "bottom" : "top");

    const center = rect.left + rect.width / 2;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (center - TOOLTIP_W / 2 < 8) setAlign("left");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else if (center + TOOLTIP_W / 2 > vpW - 8) setAlign("right");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else setAlign("center");
  }, [open]);

  if (!content) return <>{children}</>;

  // Horizontal position classes
  const hPos: Record<Align, string> = {
    left:   "left-0",
    center: "left-1/2 -translate-x-1/2",
    right:  "right-0",
  };

  // Vertical position classes
  const vPos: Record<Side, string> = {
    top:    "bottom-full mb-2",
    bottom: "top-full mt-2",
  };

  return (
    <div
      ref={triggerRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open && (
        <div
          ref={tooltipRef}
          className={`absolute z-50 w-64 p-3 rounded-lg border border-[var(--color-border-hover)] bg-[var(--color-bg-primary)] shadow-2xl text-xs text-[var(--color-text-secondary)] leading-relaxed pointer-events-none whitespace-normal ${vPos[side]} ${hPos[align]}`}
        >
          {content}
        </div>
      )}
    </div>
  );
}
