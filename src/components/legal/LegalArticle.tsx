import type { ReactNode } from "react";

/** Shared layout for the Terms, Privacy, and Contact pages. */
export function LegalArticle({
  title,
  subtitle,
  intro,
  children,
}: {
  title: string;
  subtitle?: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">
        {title}
      </h1>
      {subtitle ? (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{subtitle}</p>
      ) : null}
      {intro ? (
        <p className="mt-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {intro}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col gap-7">{children}</div>
    </main>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
        {heading}
      </h2>
      <div className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        {children}
      </div>
    </section>
  );
}
