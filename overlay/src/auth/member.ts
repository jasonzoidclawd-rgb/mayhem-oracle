import { invoke } from "@tauri-apps/api/core";
import type { DecisionModelConfig } from "../decision/model-config";

export interface MemberSnapshot {
  enabled: boolean;
  accessKind?: "member" | "trial" | "trial-lease";
  manifest?: {
    modelVersion: string;
    engineVersion: string;
    dataVersion: string;
    createdAt: string;
    configSha256: string;
    signature: string;
  };
  modelConfig?: DecisionModelConfig;
  lease?: {
    kind: string;
    gameHash: string;
    expiresAt: string;
  };
  error?: string;
}

export function memberRecommendationsVisible(
  collectorEnabled: boolean,
  member: Pick<MemberSnapshot, "enabled"> | null,
): boolean {
  return collectorEnabled && member?.enabled === true;
}

export function shouldVerifyGameStart(
  previousGameHash: string | null,
  currentGameHash: string | null,
): boolean {
  return currentGameHash !== null && previousGameHash !== currentGameHash;
}

export function disabledMember(error: string): MemberSnapshot {
  return { enabled: false, error };
}

export function bootstrapMember(): Promise<MemberSnapshot> {
  return invoke<MemberSnapshot>("member_bootstrap");
}

export function verifyMemberGameStart(gameHash: string): Promise<MemberSnapshot> {
  return invoke<MemberSnapshot>("member_game_start", { gameHash });
}
