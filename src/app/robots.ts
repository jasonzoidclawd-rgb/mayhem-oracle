import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Open to all crawlers — including AI answer engines (GPTBot, ClaudeBot,
 * PerplexityBot, Google-Extended). Being citable by LLMs is a deliberate
 * distribution channel: rivals (blitz/u.gg) bot-wall these; we don't.
 * Member-only and account surfaces are disallowed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/account", "/admin", "/api/", "/auth/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
