import type { Fight, MechanicResult, Metric, Report } from '../shared/types.js';
import {
  ENCOUNTER_RULE_VERSION,
  encounterFor,
  normaliseSpell,
  RAID_DIFFICULTIES,
  ruleSource,
  type MechanicRule,
} from '../shared/encounters.js';
import { aliveIntervals, type LifeEvent } from '../shared/life.js';
import { roleFromSpec } from '../shared/players.js';
import { evidenceUrl } from '../shared/report-url.js';
export type EncounterEvent = {
  type: string;
  timestamp: number;
  sourceID?: number;
  targetID?: number;
  abilityGameID?: number;
  extraAbilityGameID?: number;
  tick?: boolean;
  amount?: number;
  absorbed?: number;
  stack?: number;
  missType?: string;
  hitType?: number;
  killingAbilityGameID?: number;
  feign?: boolean;
};
const auraApply = new Set([
  'applydebuff',
  'applybuff',
  'applydebuffstack',
  'applybuffstack',
  'refreshdebuff',
  'refreshbuff',
]);
const auraRemove = new Set(['removedebuff', 'removebuff']);
const isHit = (e: EncounterEvent) =>
  e.type === 'damage' && !e.missType && ![0, 7, 8, 14].includes(e.hitType ?? -1);
/** Match exact live names only, within a verified encounter. Unknown spell IDs fail closed. */
function idsFor(abilities: Map<number, string>, names: string[], exact?: number[]) {
  const wanted = new Set(names.map(normaliseSpell));
  return new Set(
    [...abilities]
      .filter(([id, name]) => (!exact || exact.includes(id)) && wanted.has(normaliseSpell(name)))
      .map(([id]) => id),
  );
}
export function encounterFilter(fight: Fight, abilities: Map<number, string>): string[] {
  const entry = encounterFor(fight.encounterId);
  if (!entry || !RAID_DIFFICULTIES.includes(fight.difficulty as any)) return [];
  const names = entry.rules
    .filter((r) => !r.difficulties || r.difficulties.includes(fight.difficulty))
    .flatMap((r) => [...r.hits, ...r.casts, ...(r.failure ?? []), ...(r.aura ? [r.aura] : [])]);
  const ids = [...idsFor(abilities, names)];
  if (!ids.length) return [];
  return [
    '(source.disposition = "enemy" and ability.id != 1 and (type = "damage" or type = "cast" or type = "begincast"))',
    `(inCategory("auras") = true and target.type = "player" and (${ids.map((id) => `ability.id = ${id}`).join(' or ')}))`,
  ];
}
export function evaluateEncounter(
  report: Report,
  fight: Fight,
  metrics: Map<number, Metric>,
  input: EncounterEvent[],
  life: Map<number, LifeEvent[]>,
  abilities: Map<number, string>,
): { rule: string | null; warnings: string[] } {
  const entry = encounterFor(fight.encounterId);
  if (!entry || !RAID_DIFFICULTIES.includes(fight.difficulty as any))
    return { rule: null, warnings: [] };
  // One sorted/indexed stream for every rule; actors and alive intervals are reused.
  const events = input
    .filter(
      (e) =>
        e.timestamp >= fight.startTime &&
        e.timestamp < fight.endTime &&
        !(e.type === 'death' && e.feign),
    )
    .sort((a, b) => a.timestamp - b.timestamp || Number(isHit(b)) - Number(isHit(a)));
  const bySpell = new Map<number, EncounterEvent[]>();
  for (const e of events) {
    const ids = [e.abilityGameID ?? 0];
    if (
      ['interrupt', 'dispel', 'steal'].includes(e.type) &&
      e.extraAbilityGameID &&
      e.extraAbilityGameID !== ids[0]
    )
      ids.push(e.extraAbilityGameID);
    for (const id of ids) {
      const list = bySpell.get(id) ?? [];
      list.push(e);
      bySpell.set(id, list);
    }
  }
  const intervals = new Map(
    [...metrics.keys()].map((id) => [id, aliveIntervals(fight, life.get(id) ?? [])]),
  );
  const roles = new Map(
    report.players.map((p) => [p.id, roleFromSpec(fight.playerSpecs?.[p.id] ?? p.spec)]),
  );
  const ruleEvents = (ids: Set<number>) =>
    [...ids]
      .flatMap((id) => bySpell.get(id) ?? [])
      .sort((a, b) => a.timestamp - b.timestamp || Number(isHit(b)) - Number(isHit(a)));
  const alive = (id: number, start: number, end: number) =>
    intervals.get(id)?.some(([a, b]) => Math.max(a, start) < Math.min(b, end)) ?? false;
  for (const m of metrics.values()) {
    m.mechanics = [];
    m.mechanicFailures = 0;
    m.mechanicOpportunities = 0;
  }
  const recognised = new Set<number>();
  for (const rule of entry.rules.filter(
    (r) => !r.difficulties || r.difficulties.includes(fight.difficulty),
  )) {
    const hits = idsFor(abilities, rule.hits, rule.hitIds),
      casts = idsFor(abilities, rule.casts);
    const aura = idsFor(abilities, [rule.aura ?? rule.name], rule.vulnerabilityIds);
    const failures = idsFor(abilities, rule.failure ?? []);
    const allIds = new Set([...hits, ...casts, ...aura, ...failures]);
    for (const id of allIds) recognised.add(id);
    const stream = ruleEvents(allIds);
    const hostile = stream.filter((e) => !metrics.has(e.sourceID ?? 0));
    const contacts = hostile.filter((e) => hits.has(e.abilityGameID ?? 0) && isHit(e));
    const starts = hostile.filter((e) => casts.has(e.abilityGameID ?? 0) && e.type === 'begincast');
    const finishes = hostile.filter((e) => casts.has(e.abilityGameID ?? 0) && e.type === 'cast');
    const waves = [
      ...starts,
      ...finishes.filter(
        (e) =>
          !starts.some(
            (s) =>
              s.sourceID === e.sourceID &&
              e.timestamp >= s.timestamp &&
              e.timestamp - s.timestamp < 10000,
          ),
      ),
    ].sort((a, b) => a.timestamp - b.timestamp);
    for (const m of metrics.values()) {
      const result: MechanicResult = {
        ruleId: `${entry.id}/${rule.id}`,
        name: rule.name,
        kind: rule.kind,
        weight: rule.weight,
        opportunities: 0,
        failures: 0,
        unknown: 0,
        observed: 0,
        detail: rule.detail,
        source: ruleSource(entry),
        abilityIds: [...allIds],
        events: [],
      };
      const log = (
        e: EncounterEvent,
        outcome: MechanicResult['events'][number]['outcome'],
        detail: string,
      ) => {
        // Keep at most 12 links per rule/pull; exact counters retain every incident.
        if (result.events.length < 12)
          result.events.push({
            timestamp: e.timestamp,
            outcome,
            detail,
            url: evidenceUrl(report, fight.id, m.actorId, e.timestamp, 'damage-taken'),
          });
        if (outcome === 'failed')
          m.evidence.push({
            fightId: fight.id,
            timestamp: e.timestamp,
            abilityId: e.abilityGameID,
            ability: rule.name,
            kind: 'mechanic',
            description: detail,
            confidence: 'observed',
            ruleId: result.ruleId,
            url: evidenceUrl(report, fight.id, m.actorId, e.timestamp, 'damage-taken'),
          });
      };
      const own = contacts.filter((e) => e.targetID === m.actorId);
      // Events on an assigned actor are visible; raid events stay context, never personal blame.
      const observed = stream.filter(
        (e) =>
          e.targetID === m.actorId ||
          e.sourceID === m.actorId ||
          (['raid', 'interrupt', 'context'].includes(rule.kind) &&
            ['cast', 'begincast'].includes(e.type)),
      );
      result.observed = observed.length;
      const breakdown = new Map<number, NonNullable<MechanicResult['breakdown']>[number]>();
      for (const e of stream) {
        const utility =
          e.sourceID === m.actorId && ['interrupt', 'dispel', 'steal'].includes(e.type);
        if (e.targetID !== m.actorId && !utility) continue;
        const id = (utility ? e.extraAbilityGameID : e.abilityGameID) ?? 0;
        const row = breakdown.get(id) ?? {
          abilityId: id,
          name: abilities.get(id) ?? `Ability ${id}`,
          damage: 0,
          hits: 0,
          applications: 0,
          casts: 0,
          utility: 0,
        };
        if (isHit(e)) {
          row.damage += Math.max(0, e.amount ?? 0);
          row.hits++;
        }
        if (e.type === 'applydebuff' || e.type === 'applybuff') row.applications++;
        if (e.type === 'cast') row.casts++;
        if (utility) row.utility++;
        if (row.hits || row.applications || row.casts || row.utility) breakdown.set(id, row);
      }
      if (breakdown.size) result.breakdown = [...breakdown.values()];
      if (rule.kind === 'avoid') {
        const direct = own.filter((e) => e.tick !== true);
        const max = rule.duration ?? 12000;
        const matched = new Set<EncounterEvent>();
        for (let i = 0; i < waves.length; i++) {
          const wave = waves[i],
            end = Math.min(
              fight.endTime,
              wave.timestamp + max,
              waves.slice(i + 1).find((w) => w.sourceID === wave.sourceID)?.timestamp ?? Infinity,
            );
          if (!alive(m.actorId, wave.timestamp, end)) continue;
          const hit = direct.find(
            (e) =>
              e.sourceID === wave.sourceID && e.timestamp >= wave.timestamp && e.timestamp < end,
          );
          result.opportunities++;
          if (hit) {
            result.failures++;
            for (const e of direct)
              if (
                e.timestamp >= wave.timestamp &&
                e.timestamp < end &&
                e.sourceID === wave.sourceID
              )
                matched.add(e);
            log(
              hit,
              'failed',
              'Direct contact in an observed cast window. One failure per window; periodic ticks are excluded. Movement cause is not assigned.',
            );
          }
        }
        // Missing cast linkage cannot manufacture clean opportunities.
        let last = -Infinity;
        for (const e of direct.filter((e) => !matched.has(e))) {
          if (e.timestamp - last < 10000) continue;
          last = e.timestamp;
          result.opportunities++;
          result.failures++;
          result.unknown = Math.max(1, result.unknown);
          log(
            e,
            'failed',
            'Confirmed direct contact; the matching cast/exposure denominator is unavailable. Clean exposure remains unknown.',
          );
        }
      } else if (rule.kind === 'ground') {
        let last = -Infinity;
        for (const e of own) {
          if (e.timestamp - last < 10000) continue;
          last = e.timestamp;
          result.opportunities++;
          result.failures++;
          log(
            e,
            'failed',
            'Recorded harmful floor contact, grouped into ten-second episodes. The log does not establish who caused the movement.',
          );
        }
        if (stream.length) result.unknown = 1; // absence of ground hits never proves full clean exposure
      } else if (rule.kind === 'swap' || rule.kind === 'frontal') {
        let previous = 0,
          active = false,
          known = false,
          lastStrike = -Infinity,
          lastWave: EncounterEvent | undefined;
        const targetStream = stream.filter((e) => e.targetID === m.actorId);
        for (const e of targetStream) {
          const id = e.abilityGameID ?? 0;
          if (aura.has(id) && auraApply.has(e.type)) {
            if (!active) previous = e.timestamp;
            active = true;
            known = true;
          }
          if (aura.has(id) && auraRemove.has(e.type)) {
            active = false;
            known = true;
          }
          if (!hits.has(id) || !isHit(e) || e.tick === true) continue;
          // Channel/projectile components belong to one strike, not multiple tank swaps.
          const requiredSoak = ['Ravenous Feast', 'Guillotine', 'Mutilate'].includes(rule.name);
          let wave: EncounterEvent | undefined;
          for (let i = waves.length - 1; i >= 0; i--)
            if (waves[i].sourceID === e.sourceID && waves[i].timestamp <= e.timestamp) {
              wave = waves[i];
              break;
            }
          if (!requiredSoak && wave && e.timestamp - wave.timestamp < 20000) {
            if (wave === lastWave) continue;
            lastWave = wave;
          } else if (e.timestamp - lastStrike < (requiredSoak ? 500 : 6000)) continue;
          lastStrike = e.timestamp;
          if (roles.get(m.actorId) !== 'tank' && !requiredSoak) {
            // Dark Devastation splash can hit bystanders and does not prove who mispositioned.
            if (rule.name === 'Dark Devastation') {
              log(
                e,
                'observed',
                'Tank splash contact; ownership of the positioning error is not established.',
              );
              continue;
            }
            result.opportunities++;
            result.failures++;
            log(
              e,
              'failed',
              'Non-tank contact with a tank-only attack. This confirms contact, not which player aimed the ability.',
            );
            continue;
          }
          if (rule.kind === 'frontal') {
            log(e, 'observed', 'Required tank contact; no avoidance penalty.');
            continue;
          }
          if (!known) {
            result.unknown++;
            log(
              e,
              'unknown',
              'Required contact; prior vulnerability state is not yet established.',
            );
            continue;
          }
          result.opportunities++;
          if (active && e.timestamp - previous > (requiredSoak ? 250 : 1500)) {
            result.failures++;
            log(
              e,
              'failed',
              requiredSoak
                ? 'Another soak while the previous vulnerability was active.'
                : 'New tank strike while the previous vulnerability was active. Review both tanks, deaths, immunities and the swap plan; this is not sole-player blame.',
            );
          } else
            log(
              e,
              'passed',
              'New strike with the observed prior vulnerability cleared. Required contact earns no avoidance penalty.',
            );
        }
      } else if (rule.kind === 'resolve') {
        const applies = stream.filter(
          (e) =>
            e.targetID === m.actorId &&
            (e.type === 'applydebuff' || e.type === 'applybuff') &&
            idsFor(abilities, [rule.name]).has(e.abilityGameID ?? 0),
        );
        for (const start of applies) {
          const next = applies.find((e) => e.timestamp > start.timestamp)?.timestamp ?? Infinity;
          const deadline = start.timestamp + (rule.duration ?? 20000);
          const bad = (rule.lethalFailure ? events : stream).find(
            (e) =>
              e.targetID === m.actorId &&
              e.timestamp >= start.timestamp &&
              e.timestamp < Math.min(next, deadline) &&
              (rule.lethalFailure
                ? e.type === 'death' && failures.has(e.killingAbilityGameID ?? 0)
                : failures.has(e.abilityGameID ?? 0) && (isHit(e) || e.type === 'applydebuff')),
          );
          const remove = stream.find(
            (e) =>
              e.targetID === m.actorId &&
              e.timestamp > start.timestamp &&
              e.timestamp < Math.min(next, deadline) &&
              auraRemove.has(e.type) &&
              e.abilityGameID === start.abilityGameID,
          );
          const death = (life.get(m.actorId) ?? []).some(
            (e) => e.type === 'death' && e.timestamp >= start.timestamp && e.timestamp <= deadline,
          );
          if (bad) {
            result.opportunities++;
            result.failures++;
            log(
              bad,
              'failed',
              'The marked mechanic produced its recorded failure effect. Review the linked events for responsibility.',
            );
          } else if (remove && !death && remove.timestamp < fight.endTime - 1000) {
            result.opportunities++;
            log(
              remove,
              'passed',
              'The marked aura was removed while alive before its deadline. Resolution is observed; the log does not prove the chosen route was optimal.',
            );
          } else {
            result.unknown++;
            log(
              start,
              'unknown',
              'Resolution is censored by death, pull end or a missing terminal event; no success/failure is invented.',
            );
          }
        }
      } else {
        const utility = observed.filter(
          (e) => e.sourceID === m.actorId && ['interrupt', 'dispel', 'steal'].includes(e.type),
        );
        for (const e of utility)
          log(
            e,
            'passed',
            `${e.type === 'interrupt' ? 'Interrupted' : 'Dispelled'} ${abilities.get(e.extraAbilityGameID ?? 0) ?? rule.name}. Successful logged utility; missed assignments are not invented.`,
          );
        const e = observed.find((e) => !utility.includes(e));
        if (e) log(e, 'observed', rule.detail);
      }
      m.mechanics!.push(result);
      m.mechanicFailures! += result.failures;
      m.mechanicOpportunities! += result.opportunities;
    }
  }
  // New/renamed mechanics remain visible even before a new adapter is released.
  for (const m of metrics.values()) {
    const unknown = new Map<number, EncounterEvent[]>();
    for (const e of events)
      if (
        e.targetID === m.actorId &&
        !metrics.has(e.sourceID ?? 0) &&
        isHit(e) &&
        e.abilityGameID !== 1 &&
        !recognised.has(e.abilityGameID ?? 0)
      ) {
        const id = e.abilityGameID ?? 0,
          list = unknown.get(id) ?? [];
        list.push(e);
        unknown.set(id, list);
      }
    for (const [id, list] of unknown)
      m.mechanics!.push({
        ruleId: `${entry.id}/unmapped-${id}`,
        name: abilities.get(id) ?? `Ability ${id}`,
        kind: 'unmapped',
        weight: 0,
        opportunities: 0,
        failures: 0,
        unknown: 1,
        observed: list.length,
        detail:
          'Observed ability outside the verified rule catalogue. No automatic personal penalty; inspect its WCL timeline.',
        source: ruleSource(entry),
        abilityIds: [id],
        events: [
          {
            timestamp: list[0].timestamp,
            outcome: 'observed',
            detail: `${list.length} damage events; unclassified.`,
            url: evidenceUrl(report, fight.id, m.actorId, list[0].timestamp, 'damage-taken'),
          },
        ],
      });
  }
  return {
    rule: ENCOUNTER_RULE_VERSION,
    warnings: [
      'Mechanic review separates verified contact/duty checks, required soaks, shared raid incidents and unobservable assignments. Context-only or unclassified rows never silently become personal mistakes. Complete positional/causal coverage is not claimed.',
    ],
  };
}
