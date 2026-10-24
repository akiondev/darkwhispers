import type {
  CompositeAssessment,
  CompositeComponent,
  CompositeKey,
  ExecutionMechanic,
  MechanicResult,
  Metric,
  Role,
} from './types.js';

export const COMPOSITE_VERSION = 'composite/v3';
export const COMPOSITE_KEYS: CompositeKey[] = ['mechanics', 'output', 'survival'];
export const COMPOSITE_WEIGHTS: Record<Exclude<Role, 'unknown'>, Record<CompositeKey, number>> = {
  dps: { mechanics: 0.5, output: 0.3, survival: 0.2 },
  healer: { mechanics: 0.5, output: 0.2, survival: 0.3 },
  tank: { mechanics: 0.6, output: 0.1, survival: 0.3 },
};
export type ComponentObservation = { score: number | null; reason: string; basis?: string };
const total = (values: number[]) => values.reduce((a, b) => a + b, 0);
const boundedScore = (value: number) =>
  Math.abs(value - 100) < 1e-9 ? 100 : Math.max(0, Math.min(100, value));
export function unknownComponent(reason: string, basis?: string): ComponentObservation {
  return { score: null, reason, basis };
}
export function measuredComponent(
  score: number,
  reason: string,
  basis?: string,
): ComponentObservation {
  if (!Number.isFinite(score) || score < 0 || score > 100)
    throw Error('Invalid composite measurement.');
  return { score, reason, basis };
}
export function scoreComposite(
  role: Role,
  observations: Record<CompositeKey, ComponentObservation>,
  mechanicsEnabled = observations.mechanics.score !== null,
): CompositeAssessment {
  const base = COMPOSITE_WEIGHTS[role === 'unknown' ? 'dps' : role];
  const remainder = base.output + base.survival;
  const weights = mechanicsEnabled
    ? base
    : {
        mechanics: 0,
        output: base.output / remainder,
        survival: base.survival / remainder,
      };
  const components = Object.fromEntries(
    COMPOSITE_KEYS.map((key) => {
      const observation =
        role === 'unknown'
          ? unknownComponent('The specialization has no verified role.')
          : observations[key];
      if (
        observation.score !== null &&
        (!Number.isFinite(observation.score) || observation.score < 0 || observation.score > 100)
      )
        throw Error('Invalid composite measurement.');
      const weight = weights[key];
      return [
        key,
        {
          score: weight > 0 ? observation.score : null,
          weight,
          points: weight * (observation.score ?? 0),
          reason: observation.reason,
          basis: observation.basis,
        },
      ];
    }),
  ) as Record<CompositeKey, CompositeComponent>;
  const complete =
    role !== 'unknown' &&
    COMPOSITE_KEYS.every((k) => components[k].weight === 0 || components[k].score !== null);
  return {
    role,
    components,
    complete,
    score: complete ? boundedScore(total(COMPOSITE_KEYS.map((k) => components[k].points))) : null,
    scope: !complete
      ? 'unavailable'
      : mechanicsEnabled
        ? 'mechanics-output-survival'
        : 'output-survival',
  };
}

/** Keep every selected duration; average earned points and applied weights, including fallback pulls. */
export function combineComposites(
  values: { composite: CompositeAssessment; durationMs: number }[],
): CompositeAssessment {
  if (!values.length || values.some((v) => !Number.isFinite(v.durationMs) || v.durationMs <= 0))
    throw Error('Invalid composite duration.');
  const role = values[0].composite.role;
  if (values.some((v) => v.composite.role !== role))
    throw Error('Composite roles cannot be combined.');
  const duration = total(values.map((v) => v.durationMs));
  const average = (read: (v: CompositeAssessment) => number) =>
    total(values.map((v) => read(v.composite) * v.durationMs)) / duration;
  const components = Object.fromEntries(
    COMPOSITE_KEYS.map((key) => {
      const weight = average((c) => c.components[key].weight);
      const points = average((c) => c.components[key].points);
      const valid = values.every(
        (v) =>
          v.composite.components[key].weight === 0 || v.composite.components[key].score !== null,
      );
      const reasons = [...new Set(values.map((v) => v.composite.components[key].reason))];
      const bases = [
        ...new Set(values.map((v) => v.composite.components[key].basis).filter(Boolean)),
      ];
      return [
        key,
        {
          score: valid && weight > 0 ? boundedScore(points / weight) : null,
          weight,
          points,
          reason:
            reasons.length === 1
              ? reasons[0]
              : values.length +
                ' full pulls; duration-weighted points. Open a pull to see its measured scope.' +
                (key === 'output' &&
                reasons.some((reason) => reason.includes('only recorded total'))
                  ? ' Some pulls have only one role participant; their output ratio has no peer comparison.'
                  : ''),
          basis: bases.length === 1 ? bases[0] : 'mixed measured scope',
        },
      ];
    }),
  ) as Record<CompositeKey, CompositeComponent>;
  const complete = values.every((v) => v.composite.complete);
  const scopes = new Set(values.map((v) => v.composite.scope));
  return {
    role,
    components,
    complete,
    score: complete ? boundedScore(total(COMPOSITE_KEYS.map((k) => components[k].points))) : null,
    scope: !complete ? 'unavailable' : scopes.size === 1 ? values[0].composite.scope : 'mixed',
  };
}

/** Contribution, not a global parse or a spec/gear-adjusted skill estimate. Same rule on kills and wipes. */
export function outputComponent(metric: Metric, role: Role, peers: Metric[]): ComponentObservation {
  if (role === 'unknown')
    return unknownComponent(
      'The specialization has no verified role.',
      'report-relative contribution',
    );
  const kind = role === 'healer' ? 'healing' : 'damage';
  if (!peers.length || !peers.some((p) => p.actorId === metric.actorId))
    throw Error('Output comparison is missing its participant.');
  for (const m of peers)
    if (!Number.isFinite(m[kind]) || m[kind] < 0) throw Error('Invalid output measurement.');
  const maximum = Math.max(0, ...peers.map((m) => m[kind]));
  const label = role === 'healer' ? 'Healing' : 'Damage';
  const reason =
    maximum === 0
      ? 'No ' +
        label.toLowerCase() +
        ' was recorded for this role in this pull; output earns zero points.'
      : peers.length === 1
        ? label +
          ' contribution is the only recorded total for this role in this pull. The relative ratio is 100%; there is no peer comparison.'
        : label +
          ' contribution relative to the highest same-role total in this pull (' +
          peers.length +
          ' participants). Not adjusted for spec, gear or assignments.';
  return measuredComponent(
    maximum > 0 ? (100 * metric[kind]) / maximum : 0,
    reason,
    'report-relative contribution',
  );
}

function validateMechanic(r: MechanicResult) {
  if (
    ![r.opportunities, r.failures, r.unknown, r.missedWhileDead ?? 0].every(
      (v) => Number.isInteger(v) && v >= 0,
    ) ||
    !Number.isFinite(r.weight) ||
    r.weight < 0 ||
    r.failures + (r.missedWhileDead ?? 0) > r.opportunities
  )
    throw Error('Invalid mechanic measurements.');
}
const eligible = (r: MechanicResult) =>
  r.requiredForScore === true &&
  r.weight > 0 &&
  r.scoreEligible === true &&
  r.unknown === 0 &&
  r.opportunities > 0;

/** One whitelist per pull and role; a questionable rule cannot selectively disappear for its victim. */
export function mechanicRulesForPeers(peers: Metric[]): Set<string> {
  const ids = new Set<string>();
  for (const m of peers) {
    const own = new Set<string>();
    for (const r of m.mechanics ?? []) {
      if (own.has(r.ruleId)) throw Error('Duplicate mechanic rule measurements.');
      own.add(r.ruleId);
      if (r.requiredForScore && r.weight > 0) {
        validateMechanic(r);
        ids.add(r.ruleId);
      }
    }
  }
  return new Set(
    [...ids].filter((id) => {
      const rows = peers.map((m) => m.mechanics?.find((r) => r.ruleId === id));
      return rows.every((r) => r && eligible(r)) && new Set(rows.map((r) => r!.weight)).size === 1;
    }),
  );
}

export function mechanicsComponent(
  metric: Metric,
  allowedRules?: ReadonlySet<string>,
): {
  observation: ComponentObservation;
  reviews: ExecutionMechanic[];
  passed: number;
  failed: number;
  missed: number;
  opportunities: number;
} {
  const rows = metric.mechanics ?? [];
  for (const r of rows) if (r.requiredForScore && r.weight > 0) validateMechanic(r);
  const selected = (r: MechanicResult) =>
    eligible(r) && (!allowedRules || allowedRules.has(r.ruleId));
  const applicable = rows.filter(selected);
  let passed = 0,
    failed = 0,
    missed = 0,
    opportunities = 0;
  const checks = applicable.map((r) => {
    const dead = r.missedWhileDead ?? 0;
    const clean = r.opportunities - r.failures - dead;
    passed += clean;
    failed += r.failures;
    missed += dead;
    opportunities += r.opportunities;
    return { weight: r.weight, score: (100 * clean) / r.opportunities };
  });
  const weight = total(checks.map((c) => c.weight));
  const observation =
    weight > 0
      ? measuredComponent(
          total(checks.map((c) => c.score * c.weight)) / weight,
          passed +
            ' completed checks, ' +
            failed +
            ' failed checks, ' +
            missed +
            ' not completed while dead. Dead checks earn no completion credit and are not labelled mechanic failures.',
          'verified mechanic completion',
        )
      : unknownComponent(
          'No mechanic rule with a valid common opportunity set was available for this role in this pull. Output and survival supply the score.',
          'verified mechanic completion',
        );
  const reviews: ExecutionMechanic[] = rows
    .filter((r) => r.requiredForScore || r.observed > 0 || r.events.length > 0)
    .map((r) => {
      const scored = selected(r);
      return {
        ruleId: r.ruleId,
        name: r.name,
        kind: r.kind,
        scored,
        exclusion: scored
          ? undefined
          : allowedRules && !allowedRules.has(r.ruleId)
            ? 'This rule is excluded for the whole role in this pull because its common scoring opportunities could not be verified.'
            : (r.excludedReason ?? 'Recorded context; no verified individual scoring opportunity.'),
        passed: scored ? r.opportunities - r.failures - (r.missedWhileDead ?? 0) : 0,
        failed: scored ? r.failures : 0,
        missedWhileDead: scored ? (r.missedWhileDead ?? 0) : 0,
        opportunities: scored ? r.opportunities : 0,
        observed: r.observed,
        detail: r.detail,
        source: r.source,
        breakdown: r.breakdown,
        events: r.events.map((e) =>
          !scored && e.outcome !== 'observed' ? { ...e, outcome: 'observed' as const } : e,
        ),
      };
    });
  return { observation, reviews, passed, failed, missed, opportunities };
}
