import { normalizeChangeKind } from "@/lib/patch-notes/labels";
import type { ChangeKind } from "@/lib/types";

const STYLES: Record<ChangeKind, string> = {
  buffed:
    "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  nerfed:
    "bg-rose-500/15 text-rose-300 border-rose-500/30",
  changed:
    "bg-slate-500/15 text-slate-300 border-slate-500/30",
  mechanism:
    "bg-amber-500/15 text-amber-300 border-amber-500/35",
  added:
    "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  removed:
    "bg-rose-500/15 text-rose-300 border-rose-500/30",
  fixed:
    "bg-sky-500/15 text-sky-300 border-sky-500/30",
  hotfix:
    "bg-amber-500/15 text-amber-300 border-amber-500/35",
};

export function ChangeBadge({ kind, label }: { kind: ChangeKind | string; label: string }) {
  const style = STYLES[normalizeChangeKind(kind)];

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${style}`}
    >
      {label}
    </span>
  );
}
