import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Allow CommunityDragon champion icons
  images: {
    remotePatterns: [
      {
        protocol: "https" as const,
        hostname: "raw.communitydragon.org",
      },
      {
        protocol: "https" as const,
        hostname: "ddragon.leagueoflegends.com",
      },
      {
        protocol: "https" as const,
        hostname: "arammayhem.com",
      },
      {
        protocol: "https" as const,
        hostname: "pub-2322c7068eed43b08bc0dddf6528d1e2.r2.dev",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
