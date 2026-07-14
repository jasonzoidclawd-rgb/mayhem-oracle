import type { ChampionMemberViewPayload } from "@/lib/champions/member-view-contract";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ChampionMemberViewState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "non-member" }
  | { kind: "not-found" }
  | { kind: "error" }
  | { kind: "patch-mismatch"; publicPatch: string; memberPatch: string }
  | { kind: "member"; payload: ChampionMemberViewPayload };

function isMemberPayload(
  value: unknown,
  championSlug: string,
): value is ChampionMemberViewPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ChampionMemberViewPayload>;
  return payload.championSlug === championSlug &&
    typeof payload.version?.patch === "string" &&
    typeof payload.version?.dataVersion === "string" &&
    typeof payload.pool?.total === "number" &&
    Array.isArray(payload.rankings);
}

export async function requestChampionMemberView(
  championSlug: string,
  locale: string,
  publicPatch: string,
  fetcher: Fetcher = fetch,
): Promise<ChampionMemberViewState> {
  try {
    const response = await fetcher(
      `/api/champions/${encodeURIComponent(championSlug)}/member-view?locale=${encodeURIComponent(locale)}`,
      { credentials: "same-origin", cache: "no-store" },
    );
    if (response.status === 401) return { kind: "anonymous" };
    if (response.status === 403) return { kind: "non-member" };
    if (response.status === 404) return { kind: "not-found" };
    if (!response.ok) return { kind: "error" };

    const payload: unknown = await response.json();
    if (!isMemberPayload(payload, championSlug)) return { kind: "error" };
    if (payload.version.patch !== publicPatch) {
      return {
        kind: "patch-mismatch",
        publicPatch,
        memberPatch: payload.version.patch,
      };
    }
    return { kind: "member", payload };
  } catch {
    return { kind: "error" };
  }
}
