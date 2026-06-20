import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { RedeemForm } from "@/components/membership/AccountClient";
import { pickActiveEntitlement, type EntitlementRow } from "@/lib/entitlements/core";
import { createClient } from "@/lib/supabase/server";
import { CONTACT_EMAIL, languageAlternates, localizedUrl } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "members" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: {
      canonical: localizedUrl("/membership", locale),
      languages: languageAlternates("/membership"),
    },
  };
}

async function readEntitlement() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { signedIn: false, active: false };
    const { data } = await supabase
      .from("entitlements")
      .select("kind,status,starts_at,expires_at")
      .eq("user_id", user.id);
    const verdict = pickActiveEntitlement((data as EntitlementRow[]) ?? [], new Date());
    return { signedIn: true, active: verdict.active };
  } catch {
    return { signedIn: false, active: false };
  }
}

export default async function MembershipPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("members");
  const tm = await getTranslations("membership");
  const { signedIn, active } = await readEntitlement();

  const freeFeatures = t.raw("freeFeatures") as string[];
  const memberFeatures = t.raw("memberFeatures") as string[];
  const steps = [1, 2, 3].map((n) => ({
    title: t(`step${n}Title`),
    body: t(`step${n}Body`),
  }));
  const faqs = [1, 2, 3, 4].map((n) => ({ q: t(`faq${n}Q`), a: t(`faq${n}A`) }));
  const inviteHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    "Mayhem Oracle invite request",
  )}`;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-14 py-10">
      {/* ─── Hero ─── */}
      <section className="text-center">
        <span className="inline-block rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-medium uppercase tracking-widest text-amber-300">
          {t("eyebrow")}
        </span>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">{t("title")}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-[var(--color-text-secondary)]">
          {t("subtitle")}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            href="#access"
            className="rounded-lg bg-amber-400/90 px-6 py-3 font-semibold text-black transition hover:bg-amber-300"
          >
            {t("ctaStart")}
          </a>
          <a
            href={inviteHref}
            className="rounded-lg border border-white/15 px-6 py-3 font-medium text-[var(--color-text-primary)] transition hover:bg-white/5"
          >
            {t("ctaInvite")}
          </a>
        </div>
      </section>

      {/* ─── Comparison ─── */}
      <section>
        <h2 className="mb-6 text-center text-2xl font-bold">{t("compareTitle")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Free */}
          <div className="glass-card flex flex-col gap-4 p-6">
            <div>
              <h3 className="text-lg font-semibold">{t("freeTitle")}</h3>
              <p className="text-sm text-[var(--color-text-muted)]">{t("freePrice")}</p>
            </div>
            <ul className="flex flex-col gap-2.5 text-sm text-[var(--color-text-secondary)]">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="mt-0.5 text-[var(--color-neon-primary)]">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
          {/* Members */}
          <div className="relative flex flex-col gap-4 rounded-[var(--radius-card)] border border-amber-400/30 bg-amber-400/[0.04] p-6">
            <span className="absolute right-4 top-4 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-amber-300">
              {t("memberBadge")}
            </span>
            <div>
              <h3 className="text-lg font-semibold text-amber-200">{t("memberTitle")}</h3>
              <p className="text-sm text-[var(--color-text-muted)]">{t("memberPrice")}</p>
            </div>
            <ul className="flex flex-col gap-2.5 text-sm text-[var(--color-text-secondary)]">
              {memberFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="mt-0.5 text-amber-300">★</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ─── How access works ─── */}
      <section>
        <h2 className="text-center text-2xl font-bold">{t("howTitle")}</h2>
        <p className="mt-2 text-center text-sm text-[var(--color-text-muted)]">
          {t("howSubtitle")}
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {steps.map((step, i) => (
            <div key={step.title} className="glass-card flex flex-col gap-2 p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400/15 text-sm font-bold text-amber-300">
                {i + 1}
              </span>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="text-sm text-[var(--color-text-secondary)]">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Access / redeem ─── */}
      <section id="access" className="scroll-mt-24">
        <div className="glass-card mx-auto flex max-w-xl flex-col gap-5 p-6">
          {active ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="font-medium text-emerald-300">{t("activeNote")}</p>
              <Link
                href="/advisor"
                className="rounded-lg bg-amber-400/90 px-5 py-2.5 font-semibold text-black transition hover:bg-amber-300"
              >
                {tm("advTitle")} →
              </Link>
            </div>
          ) : signedIn ? (
            <>
              <p className="text-center text-sm text-[var(--color-text-secondary)]">
                {t("signedInNote")}
              </p>
              <RedeemForm
                copy={{
                  redeemTitle: tm("redeemTitle"),
                  redeemPlaceholder: tm("redeemPlaceholder"),
                  redeemButton: tm("redeemButton"),
                  redeemSuccess: tm("redeemSuccess"),
                  redeemError: tm("redeemError"),
                }}
              />
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 text-center">
              <p className="text-sm text-[var(--color-text-secondary)]">{t("howSubtitle")}</p>
              <a
                href={`/api/auth/signin?next=/${locale}/membership`}
                className="rounded-lg bg-amber-400/90 px-6 py-3 font-semibold text-black transition hover:bg-amber-300"
              >
                {t("signInCta")}
              </a>
            </div>
          )}
        </div>
      </section>

      {/* ─── Invite request ─── */}
      <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.02] p-6 text-center">
        <h2 className="text-lg font-semibold">{t("inviteTitle")}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-text-secondary)]">
          {t("inviteBody")}
        </p>
        <a
          href={inviteHref}
          className="mt-4 inline-block rounded-lg border border-amber-400/40 px-5 py-2.5 text-sm font-medium text-amber-300 transition hover:bg-amber-400/10"
        >
          {t("inviteCta")}
        </a>
      </section>

      {/* ─── FAQ ─── */}
      <section>
        <h2 className="mb-5 text-center text-2xl font-bold">{t("faqTitle")}</h2>
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {faqs.map((faq) => (
            <details
              key={faq.q}
              className="group rounded-[var(--radius-card)] border border-white/10 bg-white/[0.02] p-4"
            >
              <summary className="cursor-pointer list-none font-medium text-[var(--color-text-primary)] marker:hidden">
                <span className="flex items-center justify-between gap-3">
                  {faq.q}
                  <span className="text-[var(--color-text-muted)] transition group-open:rotate-45">
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
