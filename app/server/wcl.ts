import type { Fight, Player, Report, Role } from '../shared/types.js';
import { parseReportCode } from '../shared/report-url.js';
import { roleFromSpec, summarizeSpecs } from '../shared/players.js';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
type Fetcher = typeof fetch;
type Dict = Record<string, any>;
const object = (v: unknown): Dict =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {};
const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const text = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Fixed upstream origin: user-provided URLs are never fetched. Tokens never leave this module. */
export class WclClient {
  private token = '';
  private expires = 0;
  private refreshing: Promise<string> | null = null;
  private budget: { remaining: number; resetAt: number } | null = null;
  private inFlight = 0;
  private waiting: (() => void)[] = [];
  constructor(
    private id: string,
    private secret: string,
    private fetcher: Fetcher = fetch,
    private pause: (ms: number) => Promise<void> = sleep,
  ) {}
  get configured() {
    return Boolean(this.id && this.secret);
  }
  private async accessToken(): Promise<string> {
    if (!this.configured)
      throw new ApiError(
        'WCL_NOT_CONFIGURED',
        'Live imports are not configured yet. Warcraft Logs credentials must be supplied on the server. The demo uses synthetic data.',
        503,
      );
    if (this.token && Date.now() < this.expires - 60000) return this.token;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const response = await this.fetcher('https://www.warcraftlogs.com/oauth/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.id}:${this.secret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
      if (!response.ok)
        throw new ApiError(
          'WCL_AUTH_FAILED',
          'Warcraft Logs authentication failed. Check the server-side client credentials.',
          503,
        );
      const result = object(await response.json());
      if (typeof result.access_token !== 'string')
        throw new ApiError('WCL_AUTH_FAILED', 'Warcraft Logs did not return an access token.', 503);
      this.token = result.access_token;
      this.expires = Date.now() + Math.max(60, finite(result.expires_in)) * 1000;
      return this.token;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
  async query(query: string, variables: Record<string, unknown> = {}): Promise<Dict> {
    if (this.inFlight >= 3) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.inFlight++;
    try {
      return await this.queryUnlocked(query, variables);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.inFlight--;
    }
  }
  private async queryUnlocked(query: string, variables: Record<string, unknown>): Promise<Dict> {
    if (this.budget && this.budget.remaining < 10 && Date.now() < this.budget.resetAt)
      throw new ApiError(
        'WCL_RATE_LIMIT',
        `The Warcraft Logs API budget is exhausted. Try again in ${Math.ceil((this.budget.resetAt - Date.now()) / 60000)} minute(s).`,
        429,
      );
    for (let attempt = 0; attempt < 4; attempt++) {
      const token = await this.accessToken();
      let response: Response;
      try {
        response = await this.fetcher('https://www.warcraftlogs.com/api/v2/client', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(45000),
          redirect: 'error',
        });
      } catch {
        if (attempt < 3) {
          await this.pause(800 * 2 ** attempt);
          continue;
        }
        throw new ApiError(
          'WCL_UNAVAILABLE',
          'Warcraft Logs could not be reached. This import can be retried.',
        );
      }
      if (response.status === 401 && attempt === 0) {
        this.token = '';
        this.expires = 0;
        continue;
      }
      if (response.status === 429) {
        const raw = response.headers.get('retry-after');
        const delay = raw && /^\d+$/.test(raw) ? Number(raw) * 1000 : 2000 * 2 ** attempt;
        if (attempt < 3 && delay <= 30000) {
          await this.pause(delay);
          continue;
        }
        throw new ApiError(
          'WCL_RATE_LIMIT',
          'Warcraft Logs is rate limiting this client. Wait before retrying.',
          429,
        );
      }
      if (response.status >= 500 && attempt < 3) {
        await this.pause(1000 * 2 ** attempt);
        continue;
      }
      if (response.status === 403)
        throw new ApiError(
          'WCL_ACCESS_DENIED',
          'This report is not accessible with the public client API. Private or archived reports may require user authorization or subscription access.',
          403,
        );
      if (!response.ok)
        throw new ApiError(
          'WCL_REQUEST_FAILED',
          `Warcraft Logs rejected the request (HTTP ${response.status}).`,
        );
      let body: Dict;
      try {
        body = object(await response.json());
      } catch {
        throw new ApiError(
          'WCL_INVALID_RESPONSE',
          'Warcraft Logs returned an unreadable response.',
        );
      }
      // Partial GraphQL data is not silently accepted as a complete report.
      if (list(body.errors).length) {
        const messages = list(body.errors).map((e) => text(object(e).message));
        if (messages.some((m) => /\brate(?:[\s_-]*limit)?\b|\bpoints?\b|\bquota\b/i.test(m)))
          throw new ApiError(
            'WCL_RATE_LIMIT',
            'The Warcraft Logs API budget cannot serve this request yet.',
            429,
          );
        if (messages.some((m) => /private|permission|access|archiv/i.test(m)))
          throw new ApiError(
            'WCL_ACCESS_DENIED',
            'The report or requested data is not available to this API client.',
            403,
          );
        throw new ApiError(
          'WCL_QUERY_FAILED',
          'Warcraft Logs could not provide all requested data. No incomplete ranking was produced.',
        );
      }
      const data = object(body.data),
        rate = object(data.rateLimitData);
      if (typeof rate.limitPerHour === 'number') {
        const next = {
          remaining: rate.limitPerHour - finite(rate.pointsSpentThisHour),
          resetAt: Date.now() + finite(rate.pointsResetIn) * 1000,
        };
        if (this.budget && Math.abs(this.budget.resetAt - next.resetAt) < 5000)
          next.remaining = Math.min(next.remaining, this.budget.remaining);
        this.budget = next;
      }
      return data;
    }
    throw new ApiError('WCL_REQUEST_FAILED', 'Warcraft Logs request did not complete.');
  }
  async report(code: string): Promise<Report> {
    parseReportCode(code);
    const data = await this.query(
      `query Report($code:String!){reportData{report(code:$code){code title startTime endTime revision visibility zone{name} masterData{actors{id name type subType petOwner}} fights(killType:Encounters){id encounterID name difficulty startTime endTime kill fightPercentage friendlyPlayers friendlySpecs inProgress}}} rateLimitData{limitPerHour pointsSpentThisHour pointsResetIn}}`,
      { code },
    );
    const raw = object(object(data.reportData).report);
    if (!raw.code)
      throw new ApiError(
        'REPORT_NOT_FOUND',
        'The report was not found or is not accessible. Check its link and visibility.',
        404,
      );
    const rawFights = list(raw.fights);
    const fights: Fight[] = rawFights
      .map((f) => ({
        id: finite(f.id),
        encounterId: finite(f.encounterID),
        name: text(f.name, 'Unknown encounter'),
        difficulty: finite(f.difficulty),
        startTime: finite(f.startTime),
        endTime: finite(f.endTime),
        kill: f.kill === true,
        percentage: typeof f.fightPercentage === 'number' ? f.fightPercentage : null,
        friendlyPlayers: list(f.friendlyPlayers).filter(Number.isInteger),
        playerSpecs: Object.fromEntries(
          list(f.friendlyPlayers).map((id, index) => [
            id,
            text(list(f.friendlySpecs)[index], 'Unknown'),
          ]),
        ),
        inProgress: f.inProgress === true,
      }))
      .filter((f) => f.encounterId > 0 && f.endTime > f.startTime);
    const participants = new Set(fights.flatMap((f) => f.friendlyPlayers));
    const players: Player[] = list(object(raw.masterData).actors)
      .filter((a) => a.type === 'Player' && participants.has(a.id))
      .map((a) => {
        const actorSpecs = new Set<string>();
        rawFights.forEach((f) => {
          const index = list(f.friendlyPlayers).indexOf(a.id);
          const spec = list(f.friendlySpecs)[index];
          if (index >= 0 && typeof spec === 'string') actorSpecs.add(spec);
        });
        const { spec, role } = summarizeSpecs(actorSpecs);
        return {
          id: a.id,
          name: text(a.name, 'Unknown player'),
          class: text(a.subType, 'Unknown'),
          spec,
          role,
        };
      });
    const missing = [...participants].filter((id) => !players.some((p) => p.id === id));
    players.push(
      ...missing.map((id) => ({
        id,
        name: `Unknown actor ${id}`,
        class: 'Unknown',
        spec: 'Unknown',
        role: 'unknown' as const,
      })),
    );
    return {
      code: text(raw.code),
      title: text(raw.title, 'Warcraft Logs report'),
      startTime: finite(raw.startTime),
      endTime: finite(raw.endTime),
      revision: finite(raw.revision),
      visibility: text(raw.visibility, 'unknown'),
      source: 'warcraftlogs',
      players,
      petOwners: Object.fromEntries(
        list(object(raw.masterData).actors)
          .filter((a) => typeof a.petOwner === 'number' && a.petOwner > 0)
          .map((a) => [a.id, a.petOwner]),
      ),
      fights,
      zone: text(object(raw.zone).name, 'Unknown raid'),
      warnings: missing.length
        ? [
            'Some participating actors are missing player details; role-dependent scoring may be unavailable.',
          ]
        : [],
    };
  }
  async tables(code: string, fight: Fight): Promise<Dict> {
    const data = await this.query(
      `query Tables($code:String!,$ids:[Int]){reportData{report(code:$code){damage:table(dataType:DamageDone,fightIDs:$ids) healing:table(dataType:Healing,fightIDs:$ids) taken:table(dataType:DamageTaken,fightIDs:$ids)}} rateLimitData{limitPerHour pointsSpentThisHour pointsResetIn}}`,
      { code, ids: [fight.id] },
    );
    return object(object(data.reportData).report);
  }
  async abilities(code: string): Promise<Map<number, string>> {
    const data = await this.query(
      `query Abilities($code:String!){reportData{report(code:$code){masterData{abilities{gameID name}}}}}`,
      { code },
    );
    return new Map(
      list(object(object(object(data.reportData).report).masterData).abilities)
        .filter((a) => typeof a.gameID === 'number')
        .map((a) => [a.gameID, text(a.name, `Ability ${a.gameID}`)]),
    );
  }
  async events(
    code: string,
    fight: Fight,
    dataType: string,
    onPage: (events: Dict[]) => void,
    filterExpression: string | null = null,
  ): Promise<void> {
    let start = fight.startTime;
    let pages = 0;
    while (start < fight.endTime) {
      const data = await this.query(
        `query Events($code:String!,$ids:[Int],$start:Float,$end:Float,$kind:EventDataType,$filter:String){reportData{report(code:$code){events(fightIDs:$ids,startTime:$start,endTime:$end,dataType:$kind,filterExpression:$filter,limit:10000,useActorIDs:true,useAbilityIDs:true){data nextPageTimestamp}}} rateLimitData{limitPerHour pointsSpentThisHour pointsResetIn}}`,
        {
          code,
          ids: [fight.id],
          start,
          end: fight.endTime,
          kind: dataType,
          filter: filterExpression,
        },
      );
      const result = object(object(object(data.reportData).report).events);
      if (!Array.isArray(result.data))
        throw new ApiError(
          'WCL_MISSING_EVENTS',
          'An event page was missing. No complete ranking can be produced.',
        );
      const events = result.data.map(object);
      if (
        events.some(
          (event) =>
            typeof event.type !== 'string' ||
            !event.type ||
            typeof event.timestamp !== 'number' ||
            !Number.isFinite(event.timestamp),
        )
      ) {
        throw new ApiError(
          'WCL_INVALID_EVENTS',
          'An event page contained invalid events. Import stopped; missing evidence cannot be counted as a perfect result.',
        );
      }
      onPage(events);
      const next = result.nextPageTimestamp;
      if (next === null || next === undefined) break;
      if (typeof next !== 'number' || !Number.isFinite(next) || next <= start)
        throw new ApiError(
          'WCL_PAGINATION_FAILED',
          'The report event cursor did not advance. Import stopped to prevent missing or duplicate pages.',
        );
      start = next;
      if (++pages > 500)
        throw new ApiError(
          'REPORT_TOO_LARGE',
          'This pull exceeds the prototype event limit. Select fewer or shorter pulls.',
          422,
        );
    }
  }
  async killPercentiles(
    code: string,
    fight: Fight,
    players: Player[],
  ): Promise<Map<number, number>> {
    if (!fight.kill) return new Map();
    const data = await this.query(
      `query Rankings($code:String!,$ids:[Int]){reportData{report(code:$code){damage:rankings(fightIDs:$ids,playerMetric:dps,timeframe:Historical) healing:rankings(fightIDs:$ids,playerMetric:hps,timeframe:Historical)}}}`,
      { code, ids: [fight.id] },
    );
    const report = object(object(data.reportData).report);
    const percentiles = new Map<number, number>();
    for (const kind of ['damage', 'healing']) {
      const ranking = object(report[kind]);
      for (const item of list(ranking.data)) {
        const roles = object(item.roles);
        for (const group of Object.values(roles))
          for (const entry of list(object(group).characters)) {
            // Match an exact unique name only: ranking character IDs need not equal report actor IDs.
            const matches = players.filter((p) => {
              const role = roleFromSpec(fight.playerSpecs?.[p.id] ?? p.spec);
              return (
                p.name === entry.name &&
                role !== 'unknown' &&
                (kind === 'healing' ? role === 'healer' : role !== 'healer')
              );
            });
            const percentile = parsePercentile(entry.rankPercent);
            if (matches.length === 1 && percentile !== null)
              percentiles.set(matches[0].id, percentile);
          }
      }
    }
    return percentiles;
  }
}
export { roleFromSpec };
export function parsePercentile(value: unknown): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())
        ? Number(value)
        : NaN;
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}
export { object, finite, list, text };
