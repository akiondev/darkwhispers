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
import { aliveTime, type LifeEvent } from '../shared/life.js';
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
/** Full-pull facts: no inferred cutoff, class-response/activity grade or kill percentile. */
export async function ingestPull(
  client: WclClient,
  report: Report,
  fight: Fight,
  abilities: Map<number, string>,
  step: (message: string) => Promise<void>,
  requestedWindow?: AssessmentWindow,
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
  if (window.endTime <= fight.startTime || window.endTime > fight.endTime)
    throw new Error('Invalid assessment window.');
  fight = { ...fight, endTime: window.endTime };
  const duration = fight.endTime - fight.startTime;
  const metrics = new Map(fight.friendlyPlayers.map((id) => [id, baseMetric(id, duration)]));
  const recorder = factRecorder(fight, fight.friendlyPlayers, abilities);
  const life = new Map<number, LifeEvent[]>();
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
      abilityId: id,
      ability:
        abilities.get(id ?? 0) ||
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
      events = events.filter(
        (event) =>
          event.timestamp < fight.endTime &&
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
        if (event.timestamp < fight.startTime || event.timestamp >= fight.endTime) continue;
        const lifeKind = recordedLifeEvent(event);
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
    { includeResources: false },
  );
  for (const [id, metric] of metrics) {
    const seen = new Set<string>();
    const ordered = (life.get(id) ?? [])
      .filter((e) => {
        const key = `${e.type}:${e.timestamp}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
    let alive = ordered[0]?.type !== 'resurrect';
    const stream = ordered.filter((e) => {
      if (e.type === 'death' && alive) {
        alive = false;
        return true;
      }
      if (e.type === 'resurrect' && !alive) {
        alive = true;
        return true;
      }
      return false;
    });
    life.set(id, stream);
    metric.aliveMs = aliveTime(fight, stream);
    metric.deaths = stream.filter((e) => e.type === 'death').length;
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
