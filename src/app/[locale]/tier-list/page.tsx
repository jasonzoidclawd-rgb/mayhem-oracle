import { getTranslations, setRequestLocale } from "next-intl/server";
import { TierListClient } from "@/components/TierListClient";
import { readFile } from "fs/promises";
import path from "path";

export default async function TierListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tierList");

  const dataPath = path.join(process.cwd(), "public", "data", "champions.json");
  const raw = await readFile(dataPath, "utf-8");
  const { champions, patch } = JSON.parse(raw);

  return (
    <div className="py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-[var(--color-text-secondary)] mt-1">
          {t("subtitle")} · {t("patchLabel", { patch })}
        </p>
      </header>
      <TierListClient champions={champions} />
    </div>
  );
}
