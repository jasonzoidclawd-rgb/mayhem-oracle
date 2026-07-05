import { getTranslations } from "next-intl/server";
import { resolveAuthErrorKey } from "@/lib/auth/auth-errors";

export async function AuthErrorBanner({
  error,
}: {
  error?: string | string[] | null;
}) {
  const key = resolveAuthErrorKey(error);
  if (!key) return null;

  const t = await getTranslations("auth");

  return (
    <p
      role="alert"
      className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200"
    >
      {t(`errors.${key}`)}
    </p>
  );
}
