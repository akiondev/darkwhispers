import type { AssessmentWindow, Fight, Report, Selection } from './types.js';
import type { LifeEvent } from './life.js';
import { PULL_CACHE_VERSION } from './version.js';

/** A common automatic comparison policy, never a claim to have heard a voice wipe call. */
export function automaticEnd(fight: Fight, life: Map<number, LifeEvent[]>): number {
  if (fight.kill || fight.friendlyPlayers.length < 10) return fight.endTime;
  const roster = new Set(fight.friendlyPlayers),
    dead = new Set<number>(),
    lastDeath = new Map<number, number>();
  const events = [...life]
    .flatMap(([id, stream]) =>
      roster.has(id)
        ? stream
            .filter(
              (e) =>
                !e.feign &&
                Number.isFinite(e.timestamp) &&
                e.timestamp >= fight.startTime &&
                e.timestamp < fight.endTime &&
                ['death', 'resurrect'].includes(e.type),
            )
            .map((e) => ({ ...e, id }))
        : [],
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  for (const [id, stream] of life)
    if (
      roster.has(id) &&
      [...stream].filter((e) => !e.feign).sort((a, b) => a.timestamp - b.timestamp)[0]?.type ===
        'resurrect'
    )
      dead.add(id);
  const threshold = Math.ceil(roster.size / 2);
  let collapse: number | null = null,
    snapshot: number[] = [];
  for (let i = 0; i < events.length; ) {
    const time = events[i].timestamp;
    while (i < events.length && events[i].timestamp === time) {
      const e = events[i++];
      if (e.type === 'death') {
        if (!dead.has(e.id)) {
          dead.add(e.id);
          lastDeath.set(e.id, time);
        }
      } else {
        dead.delete(e.id);
        lastDeath.delete(e.id);
      }
    }
    if (dead.size >= threshold && collapse === null) {
      collapse = time;
      snapshot = [...lastDeath.values()];
    }
    if (dead.size < threshold) {
      collapse = null;
      snapshot = [];
    }
  }
  if (collapse === null || fight.endTime - collapse < 5000) return fight.endTime;
  // Exclude the final close-spaced death burst, not just the person crossing 50% mortality.
  const times = [...new Set(snapshot)].filter((t) => t <= collapse).sort((a, b) => a - b);
  let index = times.length - 1;
  while (index > 0 && times[index] - times[index - 1] <= 5000) index--;
  return Math.max(fight.startTime + 1, Math.min(fight.endTime, times[index] ?? collapse));
}

export function assessmentWindow(
  report: Report,
  fight: Fight,
  _selection: Selection,
  life?: Map<number, LifeEvent[]>,
): AssessmentWindow {
  if (fight.kill) return { endTime: fight.endTime, source: 'kill', confirmed: true };
  const at = report.wipeCalls?.[fight.id];
  if (at !== undefined) {
    if (!Number.isFinite(at) || at <= fight.startTime || at >= fight.endTime)
      throw new Error('Invalid recorded wipe-call timestamp.');
    return { endTime: at, source: 'logged', confirmed: true };
  }
  return {
    endTime: life ? automaticEnd(fight, life) : fight.endTime,
    source: 'automatic',
    confirmed: true,
    estimated: true,
  };
}
export function pullCacheKey(report: Report, fight: Fight, window: AssessmentWindow): string {
  return `${report.code}:${report.revision}:${fight.id}:${fight.startTime}:${fight.endTime}:${PULL_CACHE_VERSION}:${window.source}:${window.source === 'automatic' ? 'terminal-burst-v1' : window.endTime}`;
}
export const windowLabel = (window: AssessmentWindow) =>
  ({
    kill: 'Boss kill',
    logged: 'Logged wipe call',
    automatic: 'Automatic wipe assessment',
    manual: 'Previous manual stop',
    unconfirmed: 'Previous unconfirmed window',
  })[window.source];
