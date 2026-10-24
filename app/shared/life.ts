import type { Fight } from './types.js';
export type LifeEvent = { timestamp: number; type: string; feign?: boolean; isFeign?: boolean };
export type RecordedLifeEvent = { timestamp: number; type: 'death' | 'resurrect' };
export type LifeSummary = {
  aliveMs: number;
  deadMs: number;
  deaths: number;
  resurrections: number;
  /** Recorded dead intervals. A death at encounter end has a zero-length interval. */
  intervals: { start: number; end: number }[];
  events: RecordedLifeEvent[];
  issues: string[];
  complete: boolean;
};

/**
 * Reconstruct recorded life states over the entire encounter, without inferred wipe cuts.
 * Incomplete summaries retain observations but must not be presented as exact availability
 * or used to score: an unmatched resurrection does not establish when death occurred.
 */
export function summarizeLife(
  fight: Pick<Fight, 'startTime' | 'endTime'>,
  input: readonly LifeEvent[],
  livingCastTimes: readonly number[] = [],
): LifeSummary {
  if (
    !Number.isFinite(fight.startTime) ||
    !Number.isFinite(fight.endTime) ||
    fight.endTime <= fight.startTime
  )
    throw new RangeError('Life measurements require a finite, positive encounter duration.');
  const issues = new Set<string>();
  const unique = new Map<string, RecordedLifeEvent>();
  for (const event of input) {
    if (!event || typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp)) {
      issues.add('invalid-life-timestamp');
      continue;
    }
    // Neighboring encounters and out-of-combat resurrection do not change this encounter.
    if (event.timestamp < fight.startTime || event.timestamp > fight.endTime) continue;
    if (event.type !== 'death' && event.type !== 'resurrect') {
      issues.add('invalid-life-event-type');
      continue;
    }
    if (event.type === 'death' && (event.feign === true || event.isFeign === true)) continue;
    unique.set(`${event.timestamp}:${event.type}`, {
      timestamp: event.timestamp,
      type: event.type,
    });
  }
  // The canonical tie order makes results independent of pagination/order. Conflicting
  // transitions at the same timestamp remain explicitly ambiguous, never scored as exact.
  const events = [...unique.values()].sort(
    (a, b) => a.timestamp - b.timestamp || (a.type === 'death' ? -1 : 1),
  );
  const intervals: LifeSummary['intervals'] = [];
  let deadSince: number | null = null;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (index > 0 && events[index - 1].timestamp === event.timestamp)
      issues.add('simultaneous-life-transitions');
    if (event.type === 'death') {
      if (deadSince !== null) issues.add('death-without-recorded-resurrection');
      else deadSince = event.timestamp;
    } else if (deadSince === null) {
      issues.add('resurrection-without-recorded-death');
    } else {
      intervals.push({ start: deadSince, end: event.timestamp });
      deadSince = null;
    }
  }
  if (deadSince !== null) intervals.push({ start: deadSince, end: fight.endTime });
  if (livingCastTimes.some(t => Number.isFinite(t) && intervals.some(i => t > i.start && t < i.end)))
    issues.add('positive-health-cast-without-recorded-resurrection');
  const deadMs = intervals.reduce((total, interval) => total + interval.end - interval.start, 0);
  return {
    aliveMs: fight.endTime - fight.startTime - deadMs,
    deadMs,
    deaths: events.filter((event) => event.type === 'death').length,
    resurrections: events.filter((event) => event.type === 'resurrect').length,
    intervals,
    events,
    issues: [...issues].sort(),
    complete: issues.size === 0,
  };
}

/** Legacy mechanic-window helper. New factual survival scoring uses summarizeLife. */
export function aliveIntervals(fight: Fight, events: LifeEvent[]): [number, number][] {
  const ordered = events
    .filter((e) => !(e.type === 'death' && e.feign === true))
    .sort((a, b) => a.timestamp - b.timestamp);
  let alive = ordered[0]?.type !== 'resurrect',
    began = fight.startTime;
  const intervals: [number, number][] = [];
  for (const event of ordered) {
    const time = Math.max(fight.startTime, Math.min(fight.endTime, event.timestamp));
    if (event.type === 'death' && alive) {
      if (time > began) intervals.push([began, time]);
      alive = false;
    } else if (event.type === 'resurrect' && !alive) {
      began = time;
      alive = true;
    }
  }
  if (alive && fight.endTime > began) intervals.push([began, fight.endTime]);
  return intervals;
}
export const aliveTime = (fight: Fight, events: LifeEvent[]) =>
  aliveIntervals(fight, events).reduce((n, [start, end]) => n + end - start, 0);
