import type { DecisionContext, DecisionResult } from "../contracts/decision";

export type DecisionClientResult =
  | { ok: true; result: DecisionResult }
  | { ok: false; status: number; error: string; retryAfterSeconds?: number };

export interface ChampionMatrixCell {
  rarity: "silver" | "gold" | "prismatic";
  poolSize: number;
  candidates: DecisionResult["candidates"];
}

export interface ChampionMatrix {
  championSlug: string;
  mode: DecisionContext["mode"];
  modelVersion: string;
  rounds: Array<{ round: 1 | 2 | 3 | 4; rarities: ChampionMatrixCell[] }>;
}

export type MatrixClientResult =
  | { ok: true; matrix: ChampionMatrix }
  | { ok: false; status: number; error: string };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function resolveFetch(custom?: FetchLike): FetchLike {
  if (custom) return custom;
  return (input, init) => fetch(input, init);
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `request failed (${response.status})`;
  } catch {
    return `request failed (${response.status})`;
  }
}

/** POST the member decision endpoint. The engine never runs in the browser. */
export async function requestDecision(
  context: DecisionContext,
  options: { fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<DecisionClientResult> {
  const doFetch = resolveFetch(options.fetchImpl);
  let response: Response;
  try {
    response = await doFetch("/api/decision/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(context),
      signal: options.signal,
    });
  } catch {
    return { ok: false, status: 0, error: "network-error" };
  }

  if (response.ok) {
    return { ok: true, result: (await response.json()) as DecisionResult };
  }
  const error = await errorMessage(response);
  if (response.status === 429) {
    const header = response.headers.get("Retry-After");
    return {
      ok: false,
      status: 429,
      error,
      retryAfterSeconds: header ? Number(header) : undefined,
    };
  }
  return { ok: false, status: response.status, error };
}

export async function requestChampionMatrix(
  championSlug: string,
  mode: DecisionContext["mode"],
  options: { fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<MatrixClientResult> {
  const doFetch = resolveFetch(options.fetchImpl);
  let response: Response;
  try {
    response = await doFetch("/api/decision/champion-matrix", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ championSlug, mode }),
      signal: options.signal,
    });
  } catch {
    return { ok: false, status: 0, error: "network-error" };
  }
  if (response.ok) {
    return { ok: true, matrix: (await response.json()) as ChampionMatrix };
  }
  return { ok: false, status: response.status, error: await errorMessage(response) };
}
