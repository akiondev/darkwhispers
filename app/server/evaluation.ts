import type { Fight } from '../shared/types.js';
import type { LifeEvent } from '../shared/life.js';

/** An explicit comparison policy, not an inference about a raid leader's wipe call.
 * Sustained terminal 50% mortality works on any raid. Kills retain their full duration.
 */
export function evaluationWindow(
  fight: Fight,
  life: Map<number, LifeEvent[]>,
  enrage: number | null,
) {
  if (fight.kill || fight.friendlyPlayers.length < 10) return undefined;
  const roster = new Set(fight.friendlyPlayers),
    dead = new Set<number>();
  const events = [...life]
    .flatMap(([id, stream]) => stream.filter((e) => !e.feign).map((e) => ({ ...e, id })))
    .sort((a, b) => a.timestamp - b.timestamp);
  // A first resurrection establishes that the player was already dead at pull start.
  for (const [id, stream] of life)
    if (
      [...stream].filter((e) => !e.feign).sort((a, b) => a.timestamp - b.timestamp)[0]?.type ===
      'resurrect'
    )
      dead.add(id);
  const threshold = Math.ceil(roster.size / 2);
  let collapse: number | null = dead.size >= threshold ? fight.startTime : null;
  for (let i = 0; i < events.length; ) {
    const time = events[i].timestamp;
    while (i < events.length && events[i].timestamp === time) {
      const e = events[i++];
      if (!roster.has(e.id)) continue;
      if (e.type === 'death') dead.add(e.id);
      else if (e.type === 'resurrect') dead.delete(e.id);
    }
    if (dead.size >= threshold && collapse === null) collapse = time;
    if (dead.size < threshold) collapse = null;
  }
  const candidates = [
    ...(collapse === null || fight.endTime - collapse < 5000
      ? []
      : [{ endTime: collapse, reason: 'raid-collapse' as const }]),
    ...(enrage === null || fight.encounterId !== 3420 || fight.difficulty !== 5
      ? []
      : [{ endTime: enrage, reason: 'boss-enrage' as const }]),
  ].filter((x) => x.endTime > fight.startTime && x.endTime < fight.endTime);
  candidates.sort((a, b) => a.endTime - b.endTime);
  return candidates[0]
    ? { ...candidates[0], excludedMs: fight.endTime - candidates[0].endTime }
    : undefined;
}
