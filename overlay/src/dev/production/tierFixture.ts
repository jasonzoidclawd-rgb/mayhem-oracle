import type { MemberSnapshot } from "../../auth/member";
import type {
  AugmentRound,
  DecisionCandidateResult,
  DecisionResult,
} from "../../contracts/decision";
import type { TierLetter } from "../../model/tier";

export function isTierFixtureEnabled(): boolean {
  return false;
}

export const TIER_FIXTURE_MEMBER: MemberSnapshot = {
  enabled: false,
};

export interface AramggFixtureCard {
  slug: string;
  stat: {
    augmentId: string;
    grade: DecisionCandidateResult["grade"];
    winRatePercent: string;
    rawWinRate: string;
    numGames: string;
    tier: number;
    tierLetter: TierLetter;
  };
  method: string;
}

export interface AramggDebugRow {
  slug: string;
  augmentId: string;
  method: string;
  rawWinRate: string;
  winRatePercent: string;
  numGames: string;
  upstreamTier: number;
  cardTier: TierLetter;
}

export interface AramggFixturePayload {
  result: DecisionResult;
  winRateDisplayBySlug: Record<string, string | null>;
  debugRows: AramggDebugRow[];
}

export function buildAramggDecisionResult(
  _cards: AramggFixtureCard[],
  _round: AugmentRound,
): AramggFixturePayload {
  void _cards;
  void _round;
  throw new Error("development fixture unavailable");
}
