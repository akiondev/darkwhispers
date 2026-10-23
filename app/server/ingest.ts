import type { Evidence, Fight, Metric, PullData, Report } from '../shared/types.js';
import { evidenceUrl } from '../shared/report-url.js';
import { ApiError, finite, list, object, text, WclClient } from './wcl.js';

// Observed cast catalogue only. No availability assumptions, cooldown guesses or non-use penalties.
const DEFENSIVES = new Set([
  'Barkskin',
  'Survival Instincts',
  'Astral Shift',
  'Shield Wall',
  'Die by the Sword',
  'Enraged Regeneration',
  'Divine Shield',
  'Divine Protection',
  'Ardent Defender',
  'Guardian of Ancient Kings',
  'Icebound Fortitude',
  'Anti-Magic Shell',
  'Vampiric Blood',
  'Ice Block',
  'Ice Cold',
  'Alter Time',
  'Dispersion',
  'Desperate Prayer',
  'Aspect of the Turtle',
  'Survival of the Fittest',
  'Unending Resolve',
  'Dark Pact',
  'Cloak of Shadows',
  'Evasion',
  'Feint',
  'Dampen Harm',
  'Diffuse Magic',
  'Fortifying Brew',
  'Blur',
  'Netherwalk',
  'Fiery Brand',
  'Obsidian Scales',
  'Renewing Blaze',
  'Zephyr',
  'Pain Suppression',
  'Ironbark',
  'Blessing of Sacrifice',
  'Blessing of Protection',
  'Life Cocoon',
  'Guardian Spirit',
]);

export function baseMetric(actorId: number, duration: number): Metric {
  return {
    actorId,
    damage: 0,
    healing: 0,
    damageTaken: 0,
    aliveMs: duration,
    deaths: 0,
    interrupts: 0,
    dispels: 0,
    defensives: 0,
    defensiveSpells: [],
    mechanicFailures: null,
    mechanicOpportunities: null,
    utilitySuccesses: null,
    utilityOpportunities: null,
    outputPercentile: null,
    evidence: [],
  };
}
export function aliveTime(fight: Fight, life: { timestamp: number; type: string }[]): number {
  let alive = true,
    last = fight.startTime,
    total = 0;
  for (const event of [...life].sort((a, b) => a.timestamp - b.timestamp)) {
    const time = Math.max(fight.startTime, Math.min(fight.endTime, event.timestamp));
    if (time < last) continue;
    if (alive) total += time - last;
    if (event.type === 'death') alive = false;
    else if (event.type === 'resurrect') alive = true;
    last = time;
  }
  if (alive) total += fight.endTime - last;
  return Math.max(0, Math.min(fight.endTime - fight.startTime, total));
}
function tableEntries(table: unknown): Record<string, any>[] {
  const raw = object(table),
    data = object(raw.data ?? raw);
  if (!Array.isArray(data.entries))
    throw new ApiError(
      'WCL_MISSING_TABLE',
      'A requested metric table was missing. The import is incomplete.',
    );
  return data.entries.map(object);
}
export async function ingestPull(
  client: WclClient,
  report: Report,
  fight: Fight,
  abilities: Map<number, string>,
  step: (message: string) => Promise<void>,
): Promise<PullData> {
  const duration = fight.endTime - fight.startTime;
  const metrics = new Map(fight.friendlyPlayers.map((id) => [id, baseMetric(id, duration)]));
  const life = new Map<number, { timestamp: number; type: string }[]>();
  const warnings = [
    'Defensive usage is an observed cast count from a name catalogue; missing casts do not prove that a spell was available or unused.',
  ];
  const tables = await client.tables(report.code, fight);
  for (const [key, field] of [
    ['damage', 'damage'],
    ['healing', 'healing'],
    ['taken', 'damageTaken'],
  ] as const) {
    for (const entry of tableEntries(tables[key])) {
      const metric = metrics.get(finite(entry.id));
      if (metric) metric[field] = Math.max(0, finite(entry.total));
    }
  }
  const evidence = (
    id: number,
    event: Record<string, any>,
    kind: Evidence['kind'],
    description: string,
    view: string,
  ) => {
    const metric = metrics.get(id);
    if (!metric || typeof event.timestamp !== 'number') return;
    const abilityId =
      finite(event.abilityGameID) || finite(object(event.ability).guid) || undefined;
    metric.evidence.push({
      fightId: fight.id,
      timestamp: event.timestamp,
      abilityId,
      ability:
        abilities.get(abilityId ?? 0) ||
        text(
          object(event.ability).name,
          kind === 'death' ? 'Death' : `Ability ${abilityId ?? 'unknown'}`,
        ),
      kind,
      description,
      amount: typeof event.amount === 'number' ? event.amount : undefined,
      confidence: 'observed',
      url: evidenceUrl(report, fight.id, id, event.timestamp, view),
    });
  };
  await step('Reading deaths and battle resurrections');
  await client.events(
    report.code,
    fight,
    'All',
    (events) => {
      for (const event of events) {
        const id = finite(event.targetID);
        const metric = metrics.get(id);
        if (!metric) continue;
        if (event.type === 'death' || event.type === 'resurrect') {
          const stream = life.get(id) ?? [];
          stream.push({ timestamp: finite(event.timestamp), type: event.type });
          life.set(id, stream);
          if (event.type === 'death') {
            metric.deaths++;
            evidence(
              id,
              event,
              'death',
              'Recorded death. Cause and responsibility require reviewing the preceding events.',
              'deaths',
            );
          }
        }
      }
    },
    'type = "death" or type = "resurrect"',
  );
  for (const [id, metric] of metrics) metric.aliveMs = aliveTime(fight, life.get(id) ?? []);
  await step('Reading defensive casts');
  await client.events(report.code, fight, 'Casts', (events) => {
    for (const event of events) {
      if (event.type !== 'cast') continue;
      const metric = metrics.get(finite(event.sourceID));
      if (!metric) continue;
      const id = finite(event.abilityGameID) || finite(object(event.ability).guid),
        name = abilities.get(id) || text(object(event.ability).name);
      if (DEFENSIVES.has(name)) {
        metric.defensives++;
        let entry = metric.defensiveSpells.find((s) => s.id === id);
        if (!entry) {
          entry = { id, name, count: 0 };
          metric.defensiveSpells.push(entry);
        }
        entry.count++;
        evidence(
          metric.actorId,
          event,
          'defensive',
          'Observed defensive or external cooldown cast. Cast count alone is not a performance grade.',
          'casts',
        );
      }
    }
  });
  for (const kind of ['Interrupts', 'Dispels']) {
    await step(`Reading ${kind.toLowerCase()}`);
    await client.events(report.code, fight, kind, (events) => {
      for (const event of events) {
        if (event.type !== (kind === 'Interrupts' ? 'interrupt' : 'dispel')) continue;
        const metric = metrics.get(finite(event.sourceID));
        if (!metric) continue;
        if (kind === 'Interrupts') metric.interrupts++;
        else metric.dispels++;
        evidence(
          metric.actorId,
          event,
          kind === 'Interrupts' ? 'interrupt' : 'dispel',
          'Successful logged utility event. Assignments and missed opportunities are not inferred from this count.',
          kind.toLowerCase(),
        );
      }
    });
  }
  await step('Reading mechanic observations');
  const observedAuras = new Map<string, { count: number; event: Record<string, any> }>();
  await client.events(report.code, fight, 'Debuffs', (events) => {
    for (const event of events) {
      if (event.type !== 'applydebuff') continue;
      const id = finite(event.targetID);
      if (!metrics.has(id)) continue;
      const ability = finite(event.abilityGameID) || finite(object(event.ability).guid),
        key = `${id}:${ability}`;
      const observed = observedAuras.get(key);
      if (observed) observed.count++;
      else observedAuras.set(key, { count: 1, event });
    }
  });
  for (const { count, event } of observedAuras.values())
    evidence(
      finite(event.targetID),
      event,
      'mechanic-observed',
      `Debuff applied ${count} time(s); linked to its first application. This is an observation, not a confirmed mechanic failure or a scoring penalty.`,
      'debuffs',
    );
  if (fight.kill) {
    await step('Reading class/spec kill percentiles');
    try {
      const percentiles = await client.killPercentiles(report.code, fight, report.players);
      for (const [id, value] of percentiles) {
        const metric = metrics.get(id);
        if (metric) metric.outputPercentile = value;
      }
      if (!percentiles.size)
        warnings.push(
          'Historical class/spec kill percentiles were unavailable. Raw output remains visible, but output is not scored.',
        );
    } catch (error) {
      if (
        error instanceof ApiError &&
        ['WCL_ACCESS_DENIED', 'WCL_QUERY_FAILED'].includes(error.code)
      )
        warnings.push(
          'The optional historical kill percentile lookup was unavailable. Output is not scored.',
        );
      else throw error;
    }
  }
  return {
    fight,
    metrics: [...metrics.values()],
    complete: true,
    warnings,
    mechanicRule: null,
    wipeTailMs: null,
  };
}
