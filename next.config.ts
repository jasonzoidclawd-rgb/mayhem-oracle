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
    ],
  },
};

export default withNextIntl(nextConfig);
