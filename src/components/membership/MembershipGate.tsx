import { Link } from "@/i18n/navigation";

interface MembershipGateProps {
  title: string;
  body: string;
  cta: string;
}

/**
 * Shown in place of member-only decision UI for non-members. The full pool,
 * weights, and rankings are never sent to the client — this gate replaces them
 * entirely rather than blurring rendered content.
 */
export function MembershipGate({ title, body, cta }: MembershipGateProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-10 text-center">
      <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-medium uppercase tracking-widest text-amber-300">
        {title}
      </span>
      <p className="text-balance text-sm text-white/70">{body}</p>
      <Link
        href="/account"
        className="rounded-lg bg-amber-400/90 px-5 py-2.5 font-semibold text-black transition hover:bg-amber-300"
      >
        {cta}
      </Link>
    </div>
  );
}
