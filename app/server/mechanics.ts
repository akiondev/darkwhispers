import type { Evidence, Fight, Metric, Report } from '../shared/types.js';
import { aliveIntervals, type LifeEvent } from '../shared/life.js';
import { evidenceUrl } from '../shared/report-url.js';

export const TEMPEST_RULE = 'sszorak-tempest/v3';
// Journal effect 1287073 lasts 55 s; allow its 3.5 s parent cast from begincast.
const MAX_WINDOW_MS = 58500;
export type MechanicEvent = {
  type: string;
  timestamp: number;
  sourceID?: number;
  targetID?: number;
  abilityGameID?: number;
  tick?: boolean;
  amount?: number;
  absorbed?: number;
};
export function supportsTempest(fight: Fight, abilities: Map<number, string>): boolean {
  return (
    fight.encounterId === 3420 &&
    [1, 3, 4, 5, 17].includes(fight.difficulty) &&
    abilities.get(1287072) === 'Tempest' &&
    abilities.get(1287083) === 'Tempest'
  );
}
/**
 * Only grade the verified, narrow Tempest rule. Never guess assignment or soak failures.
 * Input damage must use WCL's type = "damage" predicate to exclude misses/immunities;
 * the API's serialized type alone does not make that distinction. Absorbs still count.
 */
export function applyTempest(
  report: Report,
  fight: Fight,
  metrics: Map<number, Metric>,
  events: MechanicEvent[],
  life: Map<number, LifeEvent[]>,
): { rule: string | null; warnings: string[] } {
  const waves = events
    .filter((e) => e.type === 'begincast' && e.abilityGameID === 1287072)
    .sort((a, b) => a.timestamp - b.timestamp);
  const contacts = events.filter(
    (e) =>
      e.type === 'damage' &&
      e.abilityGameID === 1287083 &&
      e.tick !== true &&
      metrics.has(e.targetID ?? 0),
  );
  const warnings = [
    'Sszorak mechanic scoring currently covers only direct Tempest contact per cast window. DoT ticks, required soaks, cyst placement, Virulence, tank swaps and other mechanics are not graded. Category coverage is not the share of all boss mechanics checked.',
  ];
  const windowEnd = (index: number) =>
    Math.min(
      waves[index + 1]?.timestamp ?? fight.endTime,
      waves[index].timestamp + MAX_WINDOW_MS,
      fight.endTime,
    );
  if (
    contacts.some(
      (hit) =>
        !waves.some(
          (w, index) =>
            w.timestamp <= hit.timestamp &&
            hit.timestamp < windowEnd(index) &&
            w.sourceID === hit.sourceID,
        ),
    )
  ) {
    return {
      rule: null,
      warnings: [
        ...warnings,
        'Tempest contact was observed without its preceding cast timeline. No mechanic grade was produced for this pull.',
      ],
    };
  }
  for (const metric of metrics.values()) {
    metric.mechanicFailures = 0;
    metric.mechanicOpportunities = 0;
    const intervals = aliveIntervals(fight, life.get(metric.actorId) ?? []);
    for (let index = 0; index < waves.length; index++) {
      const wave = waves[index],
        end = windowEnd(index);
      const hit = contacts.find(
        (e) =>
          e.targetID === metric.actorId &&
          e.sourceID === wave.sourceID &&
          e.timestamp >= wave.timestamp &&
          e.timestamp < end,
      );
      const present = intervals.some(
        ([start, finish]) => Math.max(start, wave.timestamp) < Math.min(finish, end),
      );
      if (!present && !hit) continue;
      metric.mechanicOpportunities++;
      if (!hit) continue;
      metric.mechanicFailures++;
      const evidence: Evidence = {
        fightId: fight.id,
        timestamp: hit.timestamp,
        abilityId: 1287083,
        ability: 'Tempest',
        kind: 'mechanic',
        description: `Direct Tempest contact in cast window ${index + 1}. At most one failed opportunity per window; periodic DoT ticks are excluded. Contact is observed, but the log does not establish who caused the movement.`,
        amount: hit.amount,
        confidence: 'observed',
        ruleId: TEMPEST_RULE,
        url: evidenceUrl(report, fight.id, metric.actorId, hit.timestamp, 'damage-taken'),
      };
      metric.evidence.push(evidence);
    }
  }
  return { rule: TEMPEST_RULE, warnings };
}
