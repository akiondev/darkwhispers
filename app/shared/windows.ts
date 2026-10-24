import type { AssessmentWindow, Fight, Report, Selection } from './types.js';
import type { LifeEvent } from './life.js';
import { PULL_CACHE_VERSION } from './version.js';

/** Never infer an intent to wipe or erase the death that starts a collapse. */
export function automaticEnd(fight: Fight, _life: Map<number, LifeEvent[]>): number {
  return fight.endTime;
}
export function assessmentWindow(
  _report: Report,
  fight: Fight,
  _selection: Selection,
  _life?: Map<number, LifeEvent[]>,
): AssessmentWindow {
  return { endTime: fight.endTime, source: fight.kill ? 'kill' : 'full', confirmed: true };
}
export function pullCacheKey(report: Report, fight: Fight, _window?: AssessmentWindow): string {
  return `${report.code}:${report.revision}:${fight.id}:${fight.startTime}:${fight.endTime}:${PULL_CACHE_VERSION}:full-v1`;
}
export const windowLabel = (window: AssessmentWindow) =>
  ({
    kill: 'Full encounter · kill',
    full: 'Full encounter · wipe',
    logged: 'Previous logged cutoff',
    automatic: 'Previous estimated cutoff',
    manual: 'Previous manual stop',
    unconfirmed: 'Previous unconfirmed window',
  })[window.source];
