import type { Player, TankFacts, TankReview } from './types.js';
import { gradeTankTasks, TANK_WEIGHTS } from './tank-scoring.js';

export const TANK_REVIEW_VERSION = 'tank-evidence/v1';
export const TANK_CATEGORIES = [
  {
    key: 'duties',
    name: 'Encounter duties',
    weight: TANK_WEIGHTS.duties,
    reason: 'Assignments, swaps and boss control require verified encounter rules.',
  },
  {
    key: 'defense',
    name: 'Defense and resources',
    weight: TANK_WEIGHTS.defense,
    reason:
      'Recorded protection is measurable; cooldown availability and complete defensive decisions are not established by uptime alone.',
  },
  {
    key: 'safety',
    name: 'Personal mechanics',
    weight: TANK_WEIGHTS.safety,
    reason: 'Contact, consequences and responsibility must be distinguished before grading.',
  },
  {
    key: 'utility',
    name: 'Assigned utility',
    weight: TANK_WEIGHTS.utility,
    reason: 'A cast does not establish an assigned opportunity or a missed duty.',
  },
  {
    key: 'output',
    name: 'Relevant damage',
    weight: TANK_WEIGHTS.output,
    reason:
      'Class/spec kill percentiles are optional context; they do not fill missing tank duties.',
  },
] as const;
export type TankProfile = {
  id: string;
  class: string;
  spec: string;
  primary: string[];
  defenses: string[];
  recovery: string[];
  note: string;
};
// Exact class/spec pairs matter: Protection alone cannot select warrior or paladin.
// Buff names are resolved through this report's translated ability master data.
export const TANK_PROFILES: readonly TankProfile[] = [
  {
    id: 'blood-dk',
    class: 'DeathKnight',
    spec: 'Blood',
    primary: ['Bone Shield'],
    defenses: ['Icebound Fortitude', 'Vampiric Blood', 'Dancing Rune Weapon', 'Anti-Magic Shell'],
    recovery: ['Death Strike'],
    note: 'Bone Shield is observed on melee attempts. Death Strike healing, shields, talents and reactive timing need their own context; more healing is not automatically better.',
  },
  {
    id: 'protection-warrior',
    class: 'Warrior',
    spec: 'Protection',
    primary: ['Shield Block'],
    defenses: ['Ignore Pain', 'Shield Wall', 'Last Stand', 'Spell Reflection', 'Spell Block'],
    recovery: ['Impending Victory', 'Victory Rush'],
    note: 'Shield Block coverage is measured only on melee attempts. Ignore Pain, damage school and cooldown availability are separate context.',
  },
  {
    id: 'protection-paladin',
    class: 'Paladin',
    spec: 'Protection',
    primary: ['Shield of the Righteous'],
    defenses: [
      'Ardent Defender',
      'Guardian of Ancient Kings',
      'Divine Protection',
      'Divine Shield',
      'Blessing of Spellwarding',
    ],
    recovery: ['Word of Glory', 'Lay on Hands'],
    note: 'Shield of the Righteous coverage is a physical-protection observation. Spell block, immunities, talents and threat effects are not inferred from this percentage.',
  },
  {
    id: 'guardian-druid',
    class: 'Druid',
    spec: 'Guardian',
    primary: ['Ironfur'],
    defenses: [
      'Barkskin',
      'Survival Instincts',
      'Frenzied Regeneration',
      'Lunar Beam',
      'Incarnation: Guardian of Ursoc',
    ],
    recovery: ['Frenzied Regeneration', 'Regrowth'],
    note: 'Ironfur is physical protection. Stack optimization, shields, weaving and magic-damage talents are not graded from one buff.',
  },
  {
    id: 'brewmaster-monk',
    class: 'Monk',
    spec: 'Brewmaster',
    primary: ['Shuffle'],
    defenses: ['Celestial Brew', 'Fortifying Brew', 'Dampen Harm', 'Diffuse Magic'],
    recovery: ['Expel Harm', 'Gift of the Ox'],
    note: 'Shuffle coverage is observed. Stagger ticks are not new enemy attacks; purification, delayed damage and brew charge reductions need separate verified rules.',
  },
  {
    id: 'vengeance-dh',
    class: 'DemonHunter',
    spec: 'Vengeance',
    primary: ['Demon Spikes'],
    defenses: ['Metamorphosis', 'Fiery Brand', 'Calcified Spikes', 'Painbringer'],
    recovery: ['Soul Cleave', 'Spirit Bomb', 'Consume Soul'],
    note: 'Demon Spikes does not have a universal 100% uptime requirement. Charges, Feed the Demon, other talents and alternative defenses must be known before a gap can become a penalty.',
  },
];
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');
export function tankProfile(player: Pick<Player, 'class' | 'spec'>): TankProfile | undefined {
  return TANK_PROFILES.find(
    (p) =>
      normalize(p.class) === normalize(player.class) &&
      normalize(p.spec) === normalize(player.spec),
  );
}
export function summarizeTankFacts(
  values: (TankFacts | undefined)[],
  scope?: { actorId: number; fightIds: number[] },
): TankReview {
  const measured = values.filter((x): x is TankFacts => x !== undefined);
  const keys = [
    'meleeEvents',
    'knownMeleeEvents',
    'protectedMeleeEvents',
    'unknownMeleeEvents',
    'protectionGapEpisodes',
    'resourceHits',
    'largeHits',
    'largeHitsWithDefense',
    'deathsUnderPressure',
    'selfHealing',
    'pressureMs',
  ] as const;
  const facts = Object.fromEntries(
    keys.map((key) => [key, measured.reduce((n, x) => n + x[key], 0)]),
  ) as TankReview['facts'];
  const profiles = [...new Set(measured.map((x) => x.profile))];
  const grade = gradeTankTasks(
    measured.flatMap((v) => v.tasks ?? []),
    scope,
  );
  return {
    version: TANK_REVIEW_VERSION,
    status: grade.complete ? 'complete' : facts.knownMeleeEvents > 0 ? 'partial' : 'insufficient',
    profiles,
    facts,
    protectionPercent:
      facts.knownMeleeEvents > 0
        ? (100 * facts.protectedMeleeEvents) / facts.knownMeleeEvents
        : null,
    pullsMeasured: measured.length,
    pullsMissing: values.length - measured.length,
    reasons: [
      ...profiles.flatMap((id) => TANK_PROFILES.find((p) => p.id === id)?.note ?? []),
      'Tank task grades require verified criteria on each boss. Missing categories never transfer their weight to Tempest or raw survival, and unmodelled mechanics do not establish individual fault.',
      'Protection coverage, large-hit observations, self-healing and pressure deaths are measurements, not evidence of fault or cooldown availability.',
      'Swaps involving both tanks remain shared review observations without verified individual responsibility.',
      ...(values.length !== measured.length
        ? [
            'Some selected tank pulls have no compatible class evidence. They are not treated as zero or perfect.',
          ]
        : []),
      ...(facts.unknownMeleeEvents
        ? [
            'Hits with missing initial aura state or same-timestamp aura changes are excluded from the coverage denominator.',
          ]
        : []),
    ],
    grade,
  };
}
