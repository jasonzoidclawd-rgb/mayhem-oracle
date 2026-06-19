import { handleChampionMatrix } from "@/lib/api/decision";
import { createDecisionDeps } from "@/lib/api/deps";

export async function POST(request: Request): Promise<Response> {
  return handleChampionMatrix(request, createDecisionDeps());
}
