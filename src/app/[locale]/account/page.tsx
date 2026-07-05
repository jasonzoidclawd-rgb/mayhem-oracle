import { RedeemForm } from "@/components/membership/AccountClient";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { Link } from "@/i18n/navigation";
import { pickActiveEntitlement, type EntitlementRow } from "@/lib/entitlements/core";
import { createClient } from "@/lib/supabase/server";
import { getTranslations, setRequestLocale } from "next-intl/server";

interface SessionRow {
  id: string;
  champion_slug: string;
  mode: string;
  round: number;
  created_at: string;
  result_summary: { candidates?: Array<{ augmentSlug: string; grade: string }> };
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("membership");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-4 text-white/70">{t("signInPrompt")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <GoogleSignInButton next="/account" label={t("signInCta")} />
          <Link
            href="/membership"
            className="inline-block rounded-lg border border-white/15 px-5 py-2.5 font-medium text-white/80 transition hover:bg-white/5"
          >
            {t("lockedCta")}
          </Link>
        </div>
      </main>
    );
  }

  const [{ data: entitlementRows }, { data: sessionRows }] = await Promise.all([
    supabase.from("entitlements").select("kind,status,starts_at,expires_at").eq("user_id", user.id),
    supabase
      .from("decision_sessions")
      .select("id,champion_slug,mode,round,created_at,result_summary")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const verdict = pickActiveEntitlement((entitlementRows as EntitlementRow[]) ?? [], new Date());
  const activeRow = verdict.active
    ? ((entitlementRows as EntitlementRow[]) ?? []).find(
        (row) => row.kind === verdict.entitlement.kind && row.status === "active",
      )
    : undefined;

  const statusLabel = !verdict.active
    ? t("statusInactive")
    : verdict.entitlement.kind === "member"
      ? t("statusActiveMember")
      : t("statusActiveTrial");

  const history = (sessionRows as SessionRow[] | null) ?? [];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-white/60">{t("subtitle")}</p>
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-sm uppercase tracking-widest text-white/50">{t("statusTitle")}</h2>
        <p className="mt-2 text-xl font-semibold">{statusLabel}</p>
        {verdict.active ? (
          <p className="mt-1 text-sm text-white/60">
            {t("expiresLabel")}: {activeRow?.expires_at
              ? new Date(activeRow.expires_at).toLocaleDateString(locale)
              : t("noExpiry")}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <RedeemForm
          copy={{
            redeemTitle: t("redeemTitle"),
            redeemPlaceholder: t("redeemPlaceholder"),
            redeemButton: t("redeemButton"),
            redeemSuccess: t("redeemSuccess"),
            redeemError: t("redeemError"),
          }}
        />
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-lg font-semibold">{t("historyTitle")}</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-white/50">{t("historyEmpty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {history.map((row) => (
              <li key={row.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium capitalize">{row.champion_slug}</span>
                <span className="text-white/50">
                  R{row.round} · {row.mode} ·{" "}
                  {new Date(row.created_at).toLocaleDateString(locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!verdict.active ? (
        <Link href="/advisor" className="text-sm text-amber-300 hover:underline">
          {t("lockedCta")} →
        </Link>
      ) : null}
    </main>
  );
}
