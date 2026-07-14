import { handleChampionMemberView } from "@/lib/api/champion-member-view";
import { buildChampionMemberView } from "@/lib/champions/member-view";
import { readChampionsFile } from "@/lib/data/read-public-file";
import { requireActiveEntitlement } from "@/lib/entitlements/server";

type ChampionCatalog = { champions: Array<{ slug: string }> };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return handleChampionMemberView(request, slug, {
    championExists: async (candidate) => {
      const catalog = await readChampionsFile<ChampionCatalog>();
      return catalog.champions.some((champion) => champion.slug === candidate);
    },
    requireEntitlement: () => requireActiveEntitlement(),
    loadMemberView: buildChampionMemberView,
  });
}
