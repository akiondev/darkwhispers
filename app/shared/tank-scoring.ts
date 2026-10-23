import type { TankGrade, TankTask, TankTaskCategory } from './types.js';

export const TANK_WEIGHTS = {
  duties: 35,
  defense: 30,
  safety: 20,
  utility: 10,
  output: 5,
} as const;
export const TANK_SCORE_VERSION = 'tank-task-score/v1';

/**
 * Generic to all classes/bosses. Only trusted, reviewed server rules may supply
 * task verdicts; casts, aura coverage and damage amounts are not task verdicts.
 * Bounds describe missing evidence, not statistical confidence or skill limits.
 */
export function gradeTankTasks(
  tasks: TankTask[],
  scope?: { actorId: number; fightIds: number[] },
): TankGrade {
  if (tasks.length && !scope) throw new Error('Tank task scope is required.');
  const allowed = new Set(scope?.fightIds);
  const incidents = new Map<string, TankTask>();
  for (const task of tasks) {
    if (
      task.actorId !== scope?.actorId ||
      !allowed.has(task.fightId) ||
      !Number.isInteger(task.fightId) ||
      !Object.hasOwn(TANK_WEIGHTS, task.category) ||
      !task.incidentId?.trim() ||
      !task.ruleId?.trim() ||
      !Number.isFinite(task.timestamp) ||
      !Number.isFinite(task.weight) ||
      task.weight <= 0 ||
      task.weight > 100 ||
      (task.earned !== null &&
        (!Number.isFinite(task.earned) || task.earned < 0 || task.earned > 1)) ||
      typeof task.verified !== 'boolean'
    )
      throw new Error('Invalid or out-of-scope tank evidence. No composite was produced.');
    const key = `${task.fightId}:${task.incidentId}`;
    const previous = incidents.get(key);
    if (previous) {
      if (
        previous.category !== task.category ||
        previous.weight !== task.weight ||
        previous.earned !== task.earned ||
        previous.verified !== task.verified
      )
        throw new Error(
          'Conflicting or double-counted tank incident. Resolve the primary responsibility before grading.',
        );
      continue;
    }
    incidents.set(key, task);
  }
  let lowerBound = 0,
    upperBound = 0,
    coverage = 0,
    knownIncidents = 0,
    unknownIncidents = 0;
  const categories = {} as TankGrade['categories'];
  for (const category of Object.keys(TANK_WEIGHTS) as TankTaskCategory[]) {
    const own = [...incidents.values()].filter((t) => t.category === category);
    let earned = 0,
      knownWeight = 0,
      unknownWeight = 0,
      known = 0,
      unknown = 0;
    for (const task of own) {
      if (task.verified && task.earned !== null) {
        earned += task.weight * task.earned;
        knownWeight += task.weight;
        known++;
      } else {
        unknownWeight += task.weight;
        unknown++;
      }
    }
    const total = knownWeight + unknownWeight,
      weight = TANK_WEIGHTS[category];
    const lower = total ? earned / total : 0,
      upper = total ? (earned + unknownWeight) / total : 1;
    const score = known > 0 && unknown === 0 ? 100 * lower : null;
    categories[category] = { score, weight, known, unknown };
    lowerBound += weight * lower;
    upperBound += weight * upper;
    if (score !== null) coverage += weight;
    knownIncidents += known;
    unknownIncidents += unknown;
  }
  const complete = coverage === 100;
  return {
    score: complete ? lowerBound : null,
    lowerBound,
    upperBound,
    coverage,
    complete,
    knownIncidents,
    unknownIncidents,
    categories,
  };
}

export function combineTankGrades(grades: TankGrade[]): TankGrade {
  if (!grades.length) return gradeTankTasks([]);
  const mean = (values: number[]) => values.reduce((n, v) => n + v, 0) / values.length;
  const complete = grades.every((g) => g.complete);
  const categories = {} as TankGrade['categories'];
  for (const category of Object.keys(TANK_WEIGHTS) as TankTaskCategory[]) {
    const own = grades.map((g) => g.categories[category]);
    categories[category] = {
      score: own.every((c) => c.score !== null) ? mean(own.map((c) => c.score!)) : null,
      weight: TANK_WEIGHTS[category],
      known: own.reduce((n, c) => n + c.known, 0),
      unknown: own.reduce((n, c) => n + c.unknown, 0),
    };
  }
  return {
    score: complete ? mean(grades.map((g) => g.score!)) : null,
    lowerBound: mean(grades.map((g) => g.lowerBound)),
    upperBound: mean(grades.map((g) => g.upperBound)),
    coverage: mean(grades.map((g) => g.coverage)),
    complete,
    knownIncidents: grades.reduce((n, g) => n + g.knownIncidents, 0),
    unknownIncidents: grades.reduce((n, g) => n + g.unknownIncidents, 0),
    categories,
  };
}
