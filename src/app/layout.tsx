import { headers } from "next/headers";
import "@/styles/globals.css";

// Root layout owns the single <html>/<body> — locale layout must NOT render them.
// next-intl middleware sets x-next-intl-locale on every request.
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const locale = headersList.get("x-next-intl-locale") ?? "en";

  return (
    <html lang={locale} className="dark">
      <body className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
        {children}
      </body>
    </html>
  );
}
