import { getTranslations } from "next-intl/server";
import fs from "node:fs/promises";
import path from "node:path";

async function getPatch(): Promise<string | null> {
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), "public/data/meta.json"),
      "utf-8",
    );
    const meta = JSON.parse(raw) as { patch?: string };
    return meta.patch ?? null;
  } catch {
    return null;
  }
}

export async function Footer() {
  const t = await getTranslations("common");
  const patch = await getPatch();

  return (
    <footer className="border-t border-[var(--color-border-default)] mt-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 text-sm text-[var(--color-text-muted)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium text-[var(--color-text-secondary)]">
              Mayhem Oracle
            </span>
            {patch && (
              <span className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-card)] px-2 py-0.5 text-xs">
                {t("patchLabel", { patch })}
              </span>
            )}
            <a
              href="https://arammayhem.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--color-neon-primary)] transition-colors"
            >
              {t("dataSource")}
            </a>
          </div>
          <span className="text-xs">{t("notAffiliated")}</span>
        </div>
      </div>
    </footer>
  );
}
