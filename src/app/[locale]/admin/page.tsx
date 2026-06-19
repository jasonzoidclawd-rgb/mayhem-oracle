import { AdminConsole } from "@/components/membership/AdminClient";
import { createClient } from "@/lib/supabase/server";
import { getTranslations, setRequestLocale } from "next-intl/server";

interface EntitlementSummary {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  expires_at: string | null;
}

export default async function AdminPage({
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
  const isAdmin = (user?.app_metadata as { role?: string } | undefined)?.role === "admin";

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold">{t("adminTitle")}</h1>
        <p className="mt-4 text-white/60">{t("adminOnly")}</p>
      </main>
    );
  }

  // RLS exposes entitlements to admins; the service-role write path lives in
  // the API route, so this read uses the admin's own client.
  const { data } = await supabase
    .from("entitlements")
    .select("id,user_id,kind,status,expires_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-bold">{t("adminTitle")}</h1>
        <p className="mt-1 text-sm text-white/60">{t("invitesTitle")}</p>
      </header>
      <AdminConsole
        copy={{
          createMemberInvite: t("createMemberInvite"),
          createTrialInvite: t("createTrialInvite"),
          newCodeLabel: t("newCodeLabel"),
          durationDaysLabel: t("durationDaysLabel"),
          revoke: t("revoke"),
          actionFailed: t("actionFailed"),
        }}
        initialEntitlements={(data as EntitlementSummary[] | null) ?? []}
      />
    </main>
  );
}
