export type RiotRegionalRoute = "americas" | "asia" | "europe" | "sea";

export type RiotPlatformRoute =
  | "br1"
  | "eun1"
  | "euw1"
  | "jp1"
  | "kr"
  | "la1"
  | "la2"
  | "me1"
  | "na1"
  | "oc1"
  | "ru"
  | "sg2"
  | "tr1"
  | "tw2"
  | "vn2";

export interface AccountByRiotIdParams {
  gameName: string;
  tagLine: string;
  regionalRoute?: RiotRegionalRoute;
}

export interface MatchIdsByPuuidParams {
  puuid: string;
  regionalRoute?: RiotRegionalRoute;
  start?: number;
  count?: number;
  queue?: number;
  startTime?: number;
  endTime?: number;
}

export function riotRegionalBaseUrl(route: RiotRegionalRoute = "americas"): string {
  return `https://${route}.api.riotgames.com`;
}

export function riotPlatformBaseUrl(route: RiotPlatformRoute = "na1"): string {
  return `https://${route}.api.riotgames.com`;
}

export function encodeRiotPathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function accountByRiotIdUrl({
  gameName,
  tagLine,
  regionalRoute = "americas",
}: AccountByRiotIdParams): string {
  return `${riotRegionalBaseUrl(regionalRoute)}/riot/account/v1/accounts/by-riot-id/${encodeRiotPathSegment(
    gameName,
  )}/${encodeRiotPathSegment(tagLine)}`;
}

export function matchIdsByPuuidUrl({
  puuid,
  regionalRoute = "americas",
  start = 0,
  count = 20,
  queue,
  startTime,
  endTime,
}: MatchIdsByPuuidParams): string {
  const params = new URLSearchParams({
    start: String(start),
    count: String(count),
  });

  if (queue !== undefined) {
    params.set("queue", String(queue));
  }
  if (startTime !== undefined) {
    params.set("startTime", String(startTime));
  }
  if (endTime !== undefined) {
    params.set("endTime", String(endTime));
  }

  return `${riotRegionalBaseUrl(regionalRoute)}/lol/match/v5/matches/by-puuid/${encodeRiotPathSegment(
    puuid,
  )}/ids?${params.toString()}`;
}

export function matchDetailUrl(
  matchId: string,
  regionalRoute: RiotRegionalRoute = "americas",
): string {
  return `${riotRegionalBaseUrl(regionalRoute)}/lol/match/v5/matches/${encodeRiotPathSegment(
    matchId,
  )}`;
}

export function matchTimelineUrl(
  matchId: string,
  regionalRoute: RiotRegionalRoute = "americas",
): string {
  return `${riotRegionalBaseUrl(regionalRoute)}/lol/match/v5/matches/${encodeRiotPathSegment(
    matchId,
  )}/timeline`;
}

export function platformStatusUrl(platformRoute: RiotPlatformRoute = "na1"): string {
  return `${riotPlatformBaseUrl(platformRoute)}/lol/status/v4/platform-data`;
}
