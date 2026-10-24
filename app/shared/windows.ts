import type { AssessmentWindow, Fight, Report, Selection } from './types.js';

export function assessmentWindow(
  report: Report,
  fight: Fight,
  selection: Selection,
): AssessmentWindow {
  const manual = selection.wipeStops?.[String(fight.id)];
  if (manual !== undefined) {
    if (
      fight.kill ||
      !Number.isInteger(manual) ||
      manual <= 0 ||
      manual > fight.endTime - fight.startTime
    )
      throw new Error('Manual wipe stops must lie inside a completed wipe.');
    return { endTime: fight.startTime + manual, source: 'manual', confirmed: true };
  }
  if (fight.kill) return { endTime: fight.endTime, source: 'kill', confirmed: true };
  const at = report.wipeCalls?.[fight.id];
  if (at !== undefined) {
    if (!Number.isFinite(at) || at <= fight.startTime || at >= fight.endTime)
      throw new Error('Invalid recorded wipe-call timestamp.');
    return { endTime: at, source: 'logged', confirmed: true };
  }
  return { endTime: fight.endTime, source: 'unconfirmed', confirmed: false };
}

export function validateWipeStops(report: Report, selection: Selection): void {
  if (Object.keys(selection.wipeStops ?? {}).length > 150)
    throw new Error('Too many manual wipe stops.');
  for (const key of Object.keys(selection.wipeStops ?? {})) {
    if (!/^[1-9]\d*$/.test(key)) throw new Error('Invalid wipe fight ID.');
    const fight = report.fights.find((f) => f.id === Number(key));
    if (!fight || fight.inProgress)
      throw new Error('Manual wipe stop refers to an unavailable pull.');
    assessmentWindow(report, fight, selection);
  }
}

export const windowLabel = (window: AssessmentWindow) =>
  ({
    kill: 'Boss kill',
    logged: 'Logged wipe call',
    manual: 'Manual wipe stop',
    unconfirmed: 'No wipe call · statistics only',
  })[window.source];
