import type {
  CompositeAssessment,
  CompositeComponent,
  CompositeKey,
  ExecutionMechanic,
  Metric,
  PlayerFacts,
  Role,
} from './types.js';

export const COMPOSITE_VERSION = 'composite/v1';
export const COMPOSITE_KEYS: CompositeKey[] = ['mechanics', 'output', 'survival', 'preparation'];
export const COMPOSITE_WEIGHTS: Record<Exclude<Role, 'unknown'>, Record<CompositeKey, number>> = {
  dps: { mechanics: 0.45, output: 0.3, survival: 0.2, preparation: 0.05 },
  healer: { mechanics: 0.45, output: 0.2, survival: 0.3, preparation: 0.05 },
  tank: { mechanics: 0.55, output: 0.1, survival: 0.3, preparation: 0.05 },
};
export type ComponentObservation = {
  lower: number;
  upper: number;
  coverage: number;
  reason: string;
  basis?: string;
};
const total = (values: number[]) => values.reduce((a, b) => a + b, 0);
export function unknownComponent(reason: string, basis?: string): ComponentObservation {
  return { lower: 0, upper: 100, coverage: 0, reason, basis };
}
export function measuredComponent(
  score: number,
  reason: string,
  basis?: string,
): ComponentObservation {
  if (!Number.isFinite(score) || score < 0 || score > 100)
    throw Error('Invalid composite measurement.');
  return { lower: score, upper: score, coverage: 1, reason, basis };
}
function component(observation: ComponentObservation, weight: number): CompositeComponent {
  const { lower, upper, coverage, reason, basis } = observation;
  if (
    ![lower, upper, coverage].every(Number.isFinite) ||
    lower < 0 ||
    upper > 100 ||
    upper < lower ||
    coverage < 0 ||
    coverage > 1
  )
    throw Error('Invalid composite bounds.');
  const exact = Math.abs(upper - lower) < 1e-8;
  return {
    score: exact ? lower : null,
    weight,
    points: weight * lower,
    lower: weight * lower,
    upper: weight * upper,
    coverage,
    reason,
    basis,
  };
}
export function scoreComposite(
  role: Role,
  observations: Record<CompositeKey, ComponentObservation>,
): CompositeAssessment {
  const weights = COMPOSITE_WEIGHTS[role === 'unknown' ? 'dps' : role];
  const components = Object.fromEntries(
    COMPOSITE_KEYS.map((key) => [
      key,
      component(
        role === 'unknown'
          ? unknownComponent('The specialization has no verified role.')
          : observations[key],
        weights[key],
      ),
    ]),
  ) as CompositeAssessment['components'];
  const lower = total(COMPOSITE_KEYS.map((key) => components[key].lower));
  const upper = total(COMPOSITE_KEYS.map((key) => components[key].upper));
  return {
    components,
    lower,
    upper,
    complete: role !== 'unknown' && Math.abs(upper - lower) < 1e-8,
    coverage: total(COMPOSITE_KEYS.map((key) => components[key].coverage * components[key].weight)),
  };
}

/** Duration weighting keeps missing exposure in the denominator instead of rewarding missing data. */
export function combineComposites(
  values: { composite: CompositeAssessment; durationMs: number }[],
): CompositeAssessment {
  if (!values.length || values.some((v) => !Number.isFinite(v.durationMs) || v.durationMs <= 0))
    throw Error('Invalid composite duration.');
  const duration = total(values.map((v) => v.durationMs));
  const average = (read: (v: CompositeAssessment) => number) =>
    total(values.map((v) => read(v.composite) * v.durationMs)) / duration;
  const components = Object.fromEntries(
    COMPOSITE_KEYS.map((key) => {
      const first = values[0].composite.components[key];
      if (values.some((v) => Math.abs(v.composite.components[key].weight - first.weight) > 1e-8))
        throw Error('Composite roles cannot be combined.');
      const lower = average((c) => c.components[key].lower);
      const upper = average((c) => c.components[key].upper);
      const reasons = [...new Set(values.map((v) => v.composite.components[key].reason))];
      const bases = [
        ...new Set(values.map((v) => v.composite.components[key].basis).filter(Boolean)),
      ];
      return [
        key,
        {
          score: Math.abs(upper - lower) < 1e-8 ? lower / first.weight : null,
          weight: first.weight,
          points: lower,
          lower,
          upper,
          coverage: average((c) => c.components[key].coverage),
          reason:
            reasons.length === 1
              ? reasons[0]
              : `${values.length} full pulls; duration-weighted measurements. Open a pull for its evidence.`,
          basis: bases.length === 1 ? bases[0] : 'mixed evidence',
        },
      ];
    }),
  ) as CompositeAssessment['components'];
  const lower = average((c) => c.lower),
    upper = average((c) => c.upper);
  return {
    components,
    lower,
    upper,
    coverage: average((c) => c.coverage),
    complete: values.every((v) => v.composite.complete) && Math.abs(upper - lower) < 1e-8,
  };
}

export function preparationComponent(facts: PlayerFacts): ComponentObservation {
  const state = (category: 'flask' | 'food') =>
    facts.preparation?.[category] ??
    (facts.snapshot && facts.activeAtPull.some((a) => a.category === category)
      ? 'present'
      : 'unknown');
  const states = [state('flask'), state('food')];
  const present = states.filter((v) => v === 'present').length;
  const known = states.filter((v) => v !== 'unknown').length;
  return {
    lower: present * 50,
    upper: (present + 2 - known) * 50,
    coverage: known / 2,
    reason: `Flask: ${states[0]}; food: ${states[1]}. An unrecognized or missing snapshot is not proof of missing preparation.`,
    basis: 'verified pull-start buffs',
  };
}

/** Contribution, not a global parse or a spec/gear-adjusted skill estimate. Same rule on kills and wipes. */
export function outputComponent(metric: Metric, role: Role, peers: Metric[]): ComponentObservation {
  const kind = role === 'healer' ? 'healing' : 'damage';
  const active = peers.filter(
    (m) =>
      m.damage > 0 ||
      m.healing > 0 ||
      m.interrupts > 0 ||
      m.dispels > 0 ||
      (m.facts?.casts ?? 0) > 0 ||
      m.deaths > 0,
  );
  const maximum = Math.max(0, ...active.map((m) => m[kind]));
  const basis = 'report-relative contribution';
  if (role === 'unknown' || active.length < 2 || maximum <= 0)
    return unknownComponent(
      'At least two active players in the same role and positive recorded output are needed for a comparison.',
      basis,
    );
  return measuredComponent(
    (100 * metric[kind]) / maximum,
    `${role === 'healer' ? 'Healing' : 'Damage'} contribution relative to the highest same-role total in this pull (${active.length} participants). Not adjusted for spec, gear or assignments.`,
    basis,
  );
}

export function mechanicsComponent(metric: Metric): {
  observation: ComponentObservation;
  reviews: ExecutionMechanic[];
  passed: number;
  failed: number;
  missed: number;
  opportunities: number;
} {
  const rows = metric.mechanics ?? [];
  const applicable = rows.filter(
    (r) =>
      r.requiredForScore === true &&
      r.weight > 0 &&
      (r.opportunities > 0 || r.unknown > 0 || r.observed > 0),
  );
  let passed = 0,
    failed = 0,
    missed = 0,
    opportunities = 0;
  const checks = applicable.map((r) => {
    if (
      ![r.opportunities, r.failures, r.unknown, r.missedWhileDead ?? 0, r.weight].every(
        (v) => Number.isFinite(v) && v >= 0,
      ) ||
      r.failures + (r.missedWhileDead ?? 0) > r.opportunities
    )
      throw Error('Invalid mechanic measurements.');
    if (!r.scoreEligible || r.unknown > 0 || r.opportunities <= 0)
      return { weight: r.weight, lower: 0, upper: 100, coverage: 0 };
    const dead = r.missedWhileDead ?? 0;
    const clean = r.opportunities - r.failures - dead;
    passed += clean;
    failed += r.failures;
    missed += dead;
    opportunities += r.opportunities;
    return {
      weight: r.weight,
      lower: (100 * clean) / r.opportunities,
      upper: (100 * (clean + dead)) / r.opportunities,
      coverage: (r.opportunities - dead) / r.opportunities,
    };
  });
  const weight = total(checks.map((c) => c.weight));
  const observation = !weight
    ? unknownComponent(
        'No reviewed mechanic with an observable opportunity was available in this pull.',
        'reviewed encounter rules',
      )
    : {
        lower: total(checks.map((c) => c.lower * c.weight)) / weight,
        upper: total(checks.map((c) => c.upper * c.weight)) / weight,
        coverage: total(checks.map((c) => c.coverage * c.weight)) / weight,
        reason: `${passed} verified clean checks, ${failed} failed checks, ${missed} checks unavailable while dead. Reviewed families have fixed weights; unavailable checks are not invented passes or failures.`,
        basis: 'reviewed encounter rules',
      };
  const reviews: ExecutionMechanic[] = rows
    .filter((r) => r.requiredForScore || r.observed > 0 || r.events.length > 0)
    .map((r) => {
      const scored =
        r.requiredForScore === true &&
        r.scoreEligible === true &&
        r.unknown === 0 &&
        r.opportunities > 0;
      return {
        ruleId: r.ruleId,
        name: r.name,
        kind: r.kind,
        scored,
        exclusion: scored
          ? undefined
          : (r.excludedReason ?? 'Recorded context; no verified individual scoring opportunity.'),
        passed: scored ? Math.max(0, r.opportunities - r.failures - (r.missedWhileDead ?? 0)) : 0,
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
