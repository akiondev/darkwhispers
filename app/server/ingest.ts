import type {
  AssessmentWindow,
  Evidence,
  Fight,
  Metric,
  PullData,
  Report,
} from '../shared/types.js';
import { assessmentWindow } from '../shared/windows.js';
import { evidenceUrl } from '../shared/report-url.js';
import { summarizeLife, type LifeEvent } from '../shared/life.js';
import { ApiError, finite, object, text, WclClient } from './wcl.js';
import { encounterFilter, evaluateEncounter, type EncounterEvent } from './encounter-engine.js';
import { factRecorder, recordedLifeEvent } from './facts.js';

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
const HEALING_COOLDOWNS = new Set([
  'Tranquility',
  'Divine Hymn',
  'Holy Word: Salvation',
  'Revival',
  'Restoral',
  'Rewind',
  'Emerald Communion',
  'Healing Tide Totem',
  'Spirit Link Totem',
  'Power Word: Barrier',
  'Aura Mastery',
]);
const TAUNT_CASTS = new Map([
  [355, 'Taunt'],
  [56222, 'Dark Command'],
  [115546, 'Provoke'],
  [62124, 'Hand of Reckoning'],
  [6795, 'Growl'],
  [185245, 'Torment'],
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
    overhealing: null,
    healingCooldowns: 0,
    taunts: 0,
    ravageHits: null,
    ravageVulnerableHits: null,
  };
}
export { aliveTime } from '../shared/life.js';
function tableEntries(table: unknown): Record<string, any>[] {
  const raw = object(table),
    data = object(raw.data ?? raw);
  if (!Array.isArray(data.entries))
    throw new ApiError(
      'WCL_MISSING_TABLE',
      'A requested metric table was missing. The import is incomplete.',
    );
  const entries = data.entries.map(object);
  if (
    entries.some(
      (entry) =>
        typeof entry.id !== 'number' ||
        !Number.isFinite(entry.id) ||
        typeof entry.total !== 'number' ||
        !Number.isFinite(entry.total) ||
        entry.total < 0,
    )
  ) {
    throw new ApiError(
      'WCL_INVALID_TABLE',
      'A metric table contained invalid totals. Missing measurements are not treated as zero.',
    );
  }
  return entries;
}
/** Full-pull facts for composite scoring: life, native table totals, reviewed
 * mechanics and verified preparation. No inferred cutoff or kill-only percentile
 * is substituted for wipe output. Healing total already includes credited absorbs;
 * overhealing remains separate and must never be added to this total. */
export async function ingestPull(
  client: WclClient,
  report: Report,
  fight: Fight,
  abilities: Map<number, string>,
  step: (message: string) => Promise<void>,
  requestedWindow?: AssessmentWindow,
  boundaryLife?: PullData['boundaryLife'],
): Promise<PullData> {
  const originalFight = fight;
  const window =
    requestedWindow ??
    assessmentWindow(report, fight, {
      encounterId: null,
      difficulty: null,
      mode: 'all',
      fightIds: null,
      excludeWipeTail: false,
    });
  if (window.endTime !== fight.endTime || !['full', 'kill'].includes(window.source))
    throw new Error('Full encounter window required.');
  const duration = fight.endTime - fight.startTime;
  const metrics = new Map(fight.friendlyPlayers.map((id) => [id, baseMetric(id, duration)]));
  const recorder = factRecorder(fight, fight.friendlyPlayers, abilities);
  const life = new Map<number, LifeEvent[]>();
  const selfReturns = new Map<
    number,
    { timestamp: number; abilityId: number; abilityName: string }[]
  >();
  const livingCasts = new Map<number, number[]>();
  const lifeDetails = new Map<string, NonNullable<Metric['facts']>['lifeEvents'][number]>();
  const tables = await client.tables(report.code, fight);
  for (const [key, field] of [
    ['damage', 'damage'],
    ['healing', 'healing'],
    ['taken', 'damageTaken'],
  ] as const) {
    for (const entry of tableEntries(tables[key])) {
      const metric = metrics.get(finite(entry.id));
      if (metric) metric[field] = Math.max(0, finite(entry.total));
      if (
        metric &&
        key === 'healing' &&
        typeof entry.overheal === 'number' &&
        Number.isFinite(entry.overheal) &&
        entry.overheal >= 0
      )
        metric.overhealing = entry.overheal;
    }
  }
  const addEvidence = (
    actor: number,
    e: Record<string, any>,
    kind: Evidence['kind'],
    description: string,
    view: string,
  ) => {
    const metric = metrics.get(actor);
    if (!metric) return;
    const id =
      (kind === 'death' ? finite(e.killingAbilityGameID) : 0) ||
      finite(e.abilityGameID) ||
      finite(object(e.ability).guid) ||
      undefined;
    metric.evidence.push({
      fightId: fight.id,
      timestamp: e.timestamp,
      abilityId: kind === 'death' ? finite(e.killingAbilityGameID) || id : id,
      ability:
        abilities.get((kind === 'death' ? finite(e.killingAbilityGameID) : 0) || id || 0) ||
        text(
          object(e.ability).name,
          kind === 'death' ? 'Death' : `Ability ${id ?? 'unclassified'}`,
        ),
      kind,
      description,
      amount: typeof e.amount === 'number' ? e.amount : undefined,
      confidence: 'observed',
      url: evidenceUrl(report, fight.id, actor, e.timestamp, view),
    });
  };
  const encounterClauses = encounterFilter(fight, abilities);
  const encounterEvents: EncounterEvent[] = [];
  const lifeEvidence: { actor: number; event: Record<string, any> }[] = [];
  const filter = [
    'type = "combatantinfo"',
    '(type = "cast" and source.type = "player")',
    ...encounterClauses,
    'type = "death"',
    'type = "resurrect"',
    'type = "interrupt"',
    'type = "dispel"',
    'type = "steal"',
  ].join(' or ');
  await step('Reading full-pull survival, mechanics and preparation facts');
  await client.events(
    report.code,
    fight,
    'All',
    (events) => {
      if (events.some((e) => typeof e.timestamp !== 'number' || !Number.isFinite(e.timestamp)))
        throw new ApiError('WCL_INVALID_EVENTS', 'Invalid event timestamp; no score was inferred.');
      events = events.filter(
        (event) =>
          event.timestamp <= fight.endTime &&
          (event.timestamp >= fight.startTime ||
            (event.type === 'combatantinfo' && event.timestamp >= fight.startTime - 1)),
      );
      recorder.observe(events);
      for (const event of events) {
        if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp))
          throw new ApiError(
            'WCL_INVALID_EVENTS',
            'The event timeline contained an invalid timestamp.',
          );
        if (event.timestamp < fight.startTime || event.timestamp > fight.endTime) continue;
        const lifeKind = recordedLifeEvent(event);
        if (lifeKind && (!Number.isInteger(event.targetID) || event.targetID <= 0))
          throw new ApiError(
            'WCL_INVALID_LIFE_TARGET',
            'A death or resurrection has no valid target. No survival score was inferred.',
          );
        if (event.type === 'death' && !lifeKind) continue;
        if (encounterClauses.length) {
          if (encounterEvents.length >= 250000)
            throw new ApiError(
              'MECHANIC_TIMELINE_LIMIT',
              'This pull exceeds the bounded mechanic timeline. No partial ranking was produced.',
              422,
            );
          encounterEvents.push({
            type: event.type,
            timestamp: event.timestamp,
            sourceID: event.sourceID,
            sourceInstance: event.sourceInstance ?? event.sourceInstanceID,
            targetID: event.targetID,
            targetInstance: event.targetInstance ?? event.targetInstanceID,
            abilityGameID: event.abilityGameID,
            killingAbilityGameID: event.killingAbilityGameID,
            extraAbilityGameID: event.extraAbilityGameID,
            tick: event.tick,
            amount: event.amount,
            absorbed: event.absorbed,
            stack: event.stack,
            hitType: event.hitType,
            missType: event.missType,
          });
        }
        const source = metrics.get(
          resolvePlayerSource(finite(event.sourceID), report.petOwners ?? {}),
        );
        const target = metrics.get(finite(event.targetID));
        const id = finite(event.abilityGameID) || finite(object(event.ability).guid);
        // Raw WCL resourceActor is an enum: 1=source, 2=target. An active cast with
        // positive source health can disprove a continuous dead interval, never date a missing res.
        if (event.type === 'cast' && metrics.has(event.sourceID)) {
          if (
            event.resourceActor === 1 &&
            Number.isFinite(event.hitPoints) &&
            event.hitPoints > 0 &&
            Number.isFinite(event.maxHitPoints) &&
            event.maxHitPoints > 0
          ) {
            const times = livingCasts.get(event.sourceID) ?? [];
            times.push(event.timestamp);
            livingCasts.set(event.sourceID, times);
          }
          // WCL logs successful Reincarnation as a self-cast rather than always as
          // resurrect. Same normalization is used by WoWAnalyzer's AnkhNormalizer.
          if (id === 21169 && abilities.get(id) === 'Reincarnation') {
            const returns = selfReturns.get(event.sourceID) ?? [];
            returns.push({
              timestamp: event.timestamp,
              abilityId: id,
              abilityName: 'Reincarnation',
            });
            selfReturns.set(event.sourceID, returns);
          }
        }
        if (lifeKind && target) {
          const stream = life.get(target.actorId) ?? [];
          stream.push({ timestamp: event.timestamp, type: lifeKind });
          const resurrectionNames: Record<number, string> = {
            20484: 'Rebirth',
            61999: 'Raise Ally',
            391054: 'Intercession',
            95750: 'Soulstone Resurrection',
          };
          const abilityName = abilities.get(id);
          lifeDetails.set(`${target.actorId}:${event.timestamp}:${lifeKind}`, {
            timestamp: event.timestamp,
            type: lifeKind,
            ...(id ? { abilityId: id, abilityName } : {}),
            ...(typeof event.sourceID === 'number' ? { sourceId: event.sourceID } : {}),
            ...(lifeKind === 'resurrect' &&
            !!resurrectionNames[id] &&
            resurrectionNames[id] === abilityName
              ? { combatRes: true }
              : {}),
          });
          life.set(target.actorId, stream);
          if (lifeKind === 'death') lifeEvidence.push({ actor: target.actorId, event });
        } else if (event.type === 'cast' && source) {
          const name = abilities.get(id) || text(object(event.ability).name);
          if (TAUNT_CASTS.get(id) === name) source.taunts = (source.taunts ?? 0) + 1;
          if (HEALING_COOLDOWNS.has(name))
            source.healingCooldowns = (source.healingCooldowns ?? 0) + 1;
          if (DEFENSIVES.has(name)) {
            source.defensives++;
            const existing = source.defensiveSpells.find((s) => s.id === id);
            if (existing) existing.count++;
            else source.defensiveSpells.push({ id, name, count: 1 });
          }
        } else if (source && ['interrupt', 'dispel', 'steal'].includes(event.type)) {
          const kind = event.type === 'interrupt' ? 'interrupt' : 'dispel';
          if (kind === 'interrupt') source.interrupts++;
          else source.dispels++;
          addEvidence(
            source.actorId,
            event,
            kind,
            'Successful logged utility event; assignments are not inferred.',
            kind === 'interrupt' ? 'interrupts' : 'dispels',
          );
        }
      }
    },
    filter,
    { includeResources: true },
  );
  for (const [id, metric] of metrics) {
    const recorded = life.get(id) ?? [];
    for (const returned of selfReturns.get(id) ?? []) {
      const priorDeath = Math.max(
        fight.startTime,
        ...recorded
          .filter((e) => e.type === 'death' && e.timestamp <= returned.timestamp)
          .map((e) => e.timestamp),
      );
      const nextDeath = Math.min(
        fight.endTime + 1,
        ...recorded
          .filter((e) => e.type === 'death' && e.timestamp > returned.timestamp)
          .map((e) => e.timestamp),
      );
      if (
        recorded.some(
          (e) => e.type === 'resurrect' && e.timestamp >= priorDeath && e.timestamp < nextDeath,
        )
      )
        continue;
      recorded.push({ type: 'resurrect', timestamp: returned.timestamp });
      lifeDetails.set(`${id}:${returned.timestamp}:resurrect`, {
        ...returned,
        type: 'resurrect',
        sourceId: id,
      });
    }
    const summary = summarizeLife(fight, recorded, livingCasts.get(id) ?? []);
    metric.life = summary;
    const stream = summary.events;
    life.set(id, stream);
    metric.aliveMs = summary.aliveMs;
    metric.deaths = summary.deaths;
    metric.facts = recorder.facts.get(id)!;
    metric.facts.lifeEvents = stream.map(
      (e) =>
        lifeDetails.get(`${id}:${e.timestamp}:${e.type}`) ?? {
          timestamp: e.timestamp,
          type: e.type as 'death' | 'resurrect',
        },
    );
  }
  for (const { actor, event } of lifeEvidence) {
    if (!life.get(actor)?.some((e) => e.type === 'death' && e.timestamp === event.timestamp))
      continue;
    if (
      metrics
        .get(actor)!
        .evidence.some((e) => e.kind === 'death' && e.timestamp === event.timestamp)
    )
      continue;
    addEvidence(
      actor,
      event,
      'death',
      'Recorded death. Dead time ends at the accepted resurrection or pull end.',
      'deaths',
    );
  }
  const mechanic = encounterClauses.length
    ? evaluateEncounter(report, fight, metrics, encounterEvents, life, abilities)
    : { rule: null, warnings: [] };
  return {
    fight: originalFight,
    window,
    boundaryLife,
    metrics: [...metrics.values()],
    complete: true,
    warnings: mechanic.warnings,
    mechanicRule: mechanic.rule,
    mechanicScope: mechanic.rule ? 'partial' : undefined,
    wipeTailMs: originalFight.endTime - window.endTime,
  };
}
export function resolvePlayerSource(id: number, owners: Record<number, number>): number {
  const seen = new Set<number>();
  for (let depth = 0; depth < 8; depth++) {
    if (seen.has(id)) return 0;
    seen.add(id);
    if (!owners[id]) return id;
    id = owners[id];
  }
  return 0;
}
