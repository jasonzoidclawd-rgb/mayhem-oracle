export interface SafeMatchExport {
  schemaVersion: 1;
  gameHash: string;
  patch: string;
  queueId: 2400;
  durationSeconds: number;
  collectedAt: string;
  source: "owned-history" | "snowball";
  participants: Array<{
    slot: string;
    team: 100 | 200;
    championSlug: string;
    augmentSlugs: string[];
    itemIds: string[];
    won: boolean;
    stats: {
      kills: number;
      deaths: number;
      assists: number;
      damageToChampions: number;
    };
  }>;
  contributorRounds?: Array<{
    round: 1 | 2 | 3 | 4;
    offeredAugmentSlugs: string[];
    selectedAugmentSlug?: string;
    ocrConfidence: number;
  }>;
}
