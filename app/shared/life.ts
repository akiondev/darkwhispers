import type { Fight } from './types.js';
export type LifeEvent = { timestamp: number; type: string };
export function aliveIntervals(fight: Fight, events: LifeEvent[]): [number, number][] {
  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp);
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
