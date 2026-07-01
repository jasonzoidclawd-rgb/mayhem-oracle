import {
  accountByRiotIdUrl,
  matchDetailUrl,
  matchIdsByPuuidUrl,
  matchTimelineUrl,
  platformStatusUrl,
  type MatchIdsByPuuidParams,
  type RiotPlatformRoute,
  type RiotRegionalRoute,
} from "./routing";

export interface RiotApiClientOptions {
  apiKey: string;
  regionalRoute?: RiotRegionalRoute;
  platformRoute?: RiotPlatformRoute;
  fetchImpl?: typeof fetch;
}

export interface RiotAccountDto {
  puuid: string;
  gameName?: string;
  tagLine?: string;
}

export type RiotMatchDto = Record<string, unknown>;
export type RiotTimelineDto = Record<string, unknown>;
export type RiotPlatformStatusDto = Record<string, unknown>;

export class RiotApiError extends Error {
  readonly status: number;
  readonly bodyPreview: string;

  constructor(message: string, status: number, bodyPreview: string) {
    super(message);
    this.name = "RiotApiError";
    this.status = status;
    this.bodyPreview = bodyPreview;
  }
}

export class RiotApiClient {
  private readonly apiKey: string;
  private readonly regionalRoute: RiotRegionalRoute;
  private readonly platformRoute: RiotPlatformRoute;
  private readonly fetchImpl: typeof fetch;

  constructor({
    apiKey,
    regionalRoute = "americas",
    platformRoute = "na1",
    fetchImpl = fetch,
  }: RiotApiClientOptions) {
    this.apiKey = apiKey;
    this.regionalRoute = regionalRoute;
    this.platformRoute = platformRoute;
    this.fetchImpl = fetchImpl;
  }

  async accountByRiotId(gameName: string, tagLine: string): Promise<RiotAccountDto> {
    return this.requestJson<RiotAccountDto>(
      accountByRiotIdUrl({ gameName, tagLine, regionalRoute: this.regionalRoute }),
    );
  }

  async matchIdsByPuuid(
    params: Omit<MatchIdsByPuuidParams, "regionalRoute">,
  ): Promise<string[]> {
    return this.requestJson<string[]>(
      matchIdsByPuuidUrl({ ...params, regionalRoute: this.regionalRoute }),
    );
  }

  async matchById(matchId: string): Promise<RiotMatchDto> {
    return this.requestJson<RiotMatchDto>(matchDetailUrl(matchId, this.regionalRoute));
  }

  async timelineByMatchId(matchId: string): Promise<RiotTimelineDto> {
    return this.requestJson<RiotTimelineDto>(matchTimelineUrl(matchId, this.regionalRoute));
  }

  async platformStatus(): Promise<RiotPlatformStatusDto> {
    return this.requestJson<RiotPlatformStatusDto>(platformStatusUrl(this.platformRoute));
  }

  private async requestJson<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url, {
      headers: {
        "X-Riot-Token": this.apiKey,
      },
    });
    const text = await response.text();

    if (!response.ok) {
      throw new RiotApiError(
        `Riot API request failed with HTTP ${response.status}`,
        response.status,
        text.slice(0, 500),
      );
    }

    return JSON.parse(text) as T;
  }
}
