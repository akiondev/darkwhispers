import type { Evidence, Fight, Metric, Report, TankFacts } from '../shared/types.js';
import { tankProfile, type TankProfile } from '../shared/tanks.js';
import { aliveIntervals, type LifeEvent } from '../shared/life.js';
import { evidenceUrl } from '../shared/report-url.js';

type Event = Record<string, any>;
const EXTERNALS = new Set([
  'Pain Suppression',
  'Ironbark',
  'Blessing of Sacrifice',
  'Blessing of Protection',
  'Life Cocoon',
]);
const AURAS = new Set([
  'applybuff',
  'refreshbuff',
  'applybuffstack',
  'removebuffstack',
  'removebuff',
  'applydebuff',
  'refreshdebuff',
  'applydebuffstack',
  'removedebuffstack',
  'removedebuff',
]);
const normalized = (value: string) => value.toLowerCase();
const hasName = (names: readonly string[], name: string) =>
  names.some((x) => normalized(x) === normalized(name));

/** One bounded, shared timeline. Raw gear, positions and resource arrays are not retained. */
export function tankRecorder(report: Report, fight: Fight, abilities: Map<number, string>) {
  const profiles = new Map<number, TankProfile>();
  for (const p of report.players) {
    if (!fight.friendlyPlayers.includes(p.id)) continue;
    const profile = tankProfile({ ...p, spec: fight.playerSpecs?.[p.id] ?? p.spec });
    if (profile) profiles.set(p.id, profile);
  }
  const names = new Set(
    [
      ...EXTERNALS,
      ...[...profiles.values()].flatMap((p) => [...p.primary, ...p.defenses, ...p.recovery]),
    ].map(normalized),
  );
  const ids = [...abilities].filter(([, name]) => names.has(normalized(name))).map(([id]) => id);
  const records: Event[] = [];
  const filter = profiles.size
    ? [
        'type = "combatantinfo"',
        '(inCategory("damage") = true and ability.id = 1 and source.disposition = "enemy" and target.type = "player")',
        '(type = "damage" and isTick = false and source.disposition = "enemy" and target.role = "tank")',
        ...(ids.length
          ? [
              `((inCategory("auras") = true or inCategory("healing") = true) and (${ids.map((id) => `ability.id = ${id}`).join(' or ')}))`,
            ]
          : []),
      ]
    : [];
  return {
    filter,
    active: profiles.size > 0,
    observe(events: Event[]) {
      for (const e of events) {
        if (!profiles.has(e.sourceID) && !profiles.has(e.targetID)) continue;
        if (e.type === 'death' && e.feign === true) continue;
        records.push({
          timestamp: e.timestamp,
          type: e.type,
          sourceID: e.sourceID,
          targetID: e.targetID,
          abilityGameID: e.abilityGameID,
          amount: e.amount,
          absorbed: e.absorbed,
          stack: e.stack,
          tick: e.tick,
          isAoE: e.isAoE,
          resourceActor: e.resourceActor,
          hitPoints: e.hitPoints,
          maxHitPoints: e.maxHitPoints,
          auras:
            e.type === 'combatantinfo' && Array.isArray(e.auras)
              ? e.auras.map((a: Event) => ({ ability: a.ability, stacks: a.stacks }))
              : undefined,
        });
      }
    },
    finish(metrics: Map<number, Metric>, life: Map<number, LifeEvent[]>, endTime: number) {
      records.sort(
        (a, b) =>
          a.timestamp - b.timestamp ||
          Number(b.type === 'combatantinfo') - Number(a.type === 'combatantinfo'),
      );
      for (const [id, profile] of profiles) {
        const metric = metrics.get(id);
        if (!metric) continue;
        const full = measureTank(
          report,
          fight,
          id,
          profile,
          abilities,
          records,
          life.get(id) ?? [],
          fight.endTime,
        );
        metric.tank = full.facts;
        metric.evidence.push(...full.evidence);
        if (metric.evaluated)
          metric.evaluated.tank = measureTank(
            report,
            fight,
            id,
            profile,
            abilities,
            records,
            life.get(id) ?? [],
            endTime,
          ).facts;
      }
    },
  };
}

function measureTank(
  report: Report,
  fight: Fight,
  id: number,
  profile: TankProfile,
  abilities: Map<number, string>,
  records: Event[],
  life: LifeEvent[],
  end: number,
): { facts: TankFacts; evidence: Evidence[] } {
  const facts: TankFacts = {
    profile: profile.id,
    primaryProtection: profile.primary.join(' / '),
    snapshot: false,
    meleeEvents: 0,
    knownMeleeEvents: 0,
    protectedMeleeEvents: 0,
    unknownMeleeEvents: 0,
    protectionGapEpisodes: 0,
    resourceHits: 0,
    largeHits: 0,
    largeHitsWithDefense: 0,
    deathsUnderPressure: 0,
    selfHealing: 0,
    pressureMs: 0,
    responseKnownWindows: 0,
    responseCoveredWindows: 0,
    responseUnknownWindows: 0,
  };
  const evidence: Evidence[] = [];
  const active = new Set<number>(),
    branded = new Map<number, Set<number>>();
  const playerIds = new Set(report.players.map((p) => p.id));
  const friendlySource = (source: number) => {
    const seen = new Set<number>();
    for (let i = 0; i < 8 && !seen.has(source); i++) {
      if (playerIds.has(source)) return true;
      seen.add(source);
      if (!report.petOwners?.[source]) return false;
      source = report.petOwners[source];
    }
    return true;
  };
  const relevant = records.filter(
    (e) => e.timestamp < end && (e.sourceID === id || e.targetID === id),
  );
  // A buff transition and hit at the same timestamp have no guaranteed causal order.
  const ambiguous = new Set(
    relevant
      .filter(
        (e) =>
          AURAS.has(e.type) &&
          e.targetID === id &&
          hasName(profile.primary, abilities.get(e.abilityGameID) ?? ''),
      )
      .map((e) => e.timestamp),
  );
  const primaryResolved = [...abilities.values()].some((name) => hasName(profile.primary, name));
  let known = false,
    lastEnemyHit = -Infinity,
    lastGap = -Infinity;
  const pressure: [number, number][] = [];
  const response = new Map<number, { known: boolean; covered: boolean }>();
  const recovery = new Set<number>();
  const physicalResponses = new Set([
    'Bone Shield',
    'Dancing Rune Weapon',
    'Icebound Fortitude',
    'Vampiric Blood',
    'Shield Block',
    'Ignore Pain',
    'Shield Wall',
    'Last Stand',
    'Shield of the Righteous',
    'Ardent Defender',
    'Guardian of Ancient Kings',
    'Divine Protection',
    'Divine Shield',
    'Ironfur',
    'Barkskin',
    'Survival Instincts',
    'Frenzied Regeneration',
    'Incarnation: Guardian of Ursoc',
    'Shuffle',
    'Fortifying Brew',
    'Dampen Harm',
    'Celestial Brew',
    'Demon Spikes',
    'Metamorphosis',
  ]);
  for (const e of relevant) {
    const name = abilities.get(e.abilityGameID) ?? '';
    if (e.type === 'combatantinfo' && e.sourceID === id && Array.isArray(e.auras)) {
      active.clear();
      for (const a of e.auras) if (a.stacks !== 0) active.add(a.ability);
      known = primaryResolved;
      facts.snapshot = true;
      continue;
    }
    if (AURAS.has(e.type)) {
      if (e.targetID === id) {
        const removed =
          e.type === 'removebuff' ||
          e.type === 'removedebuff' ||
          (e.type.endsWith('stack') && e.stack === 0);
        if (removed) active.delete(e.abilityGameID);
        else active.add(e.abilityGameID);
        if (hasName(profile.primary, name))
          known = !(e.type === 'removebuffstack' && typeof e.stack !== 'number');
      } else if (e.sourceID === id && name === 'Fiery Brand') {
        const set = branded.get(e.targetID) ?? new Set<number>();
        if (e.type === 'removedebuff') set.delete(e.abilityGameID);
        else set.add(e.abilityGameID);
        branded.set(e.targetID, set);
      }
      continue;
    }
    if (e.type === 'death' && e.targetID === id) {
      if (e.timestamp - lastEnemyHit <= 5000) facts.deathsUnderPressure++;
      active.clear();
      known = true;
      lastGap = -Infinity;
      continue;
    }
    if (
      e.type === 'heal' &&
      e.sourceID === id &&
      e.targetID === id &&
      typeof e.amount === 'number' &&
      e.amount >= 0
    ) {
      facts.selfHealing += e.amount;
      if (e.amount > 0) recovery.add(Math.floor((e.timestamp - fight.startTime) / 5000));
    }
    if (
      e.type !== 'damage' ||
      e.targetID !== id ||
      e.tick === true ||
      !(e.sourceID > 0) ||
      friendlySource(e.sourceID)
    )
      continue;
    lastEnemyHit = e.timestamp;
    const primary = [...active].some((ability) =>
      hasName(profile.primary, abilities.get(ability) ?? ''),
    );
    const defended =
      primary ||
      [...active].some(
        (ability) =>
          hasName(profile.defenses, abilities.get(ability) ?? '') ||
          EXTERNALS.has(abilities.get(ability) ?? ''),
      ) ||
      !!branded.get(e.sourceID)?.size;
    if (
      e.resourceActor === 2 &&
      typeof e.maxHitPoints === 'number' &&
      e.maxHitPoints > 0 &&
      typeof e.amount === 'number'
    ) {
      facts.resourceHits++;
      if (e.amount / e.maxHitPoints >= 0.25) {
        facts.largeHits++;
        if (defended) facts.largeHitsWithDefense++;
      }
    }
    if (e.abilityGameID !== 1) continue;
    const bin = Math.floor((e.timestamp - fight.startTime) / 5000);
    const prior = response.get(bin) ?? { known: true, covered: true };
    const recordedResponse =
      [...active].some((id) => physicalResponses.has(abilities.get(id) ?? '')) ||
      !!branded.get(e.sourceID)?.size;
    prior.known &&= (known || recordedResponse) && !ambiguous.has(e.timestamp);
    prior.covered &&= recordedResponse;
    response.set(bin, prior);
    facts.meleeEvents++;
    const previous = pressure.at(-1),
      until = Math.min(end, e.timestamp + 5000);
    if (previous && e.timestamp <= previous[1]) previous[1] = Math.max(previous[1], until);
    else pressure.push([e.timestamp, until]);
    if (!known || ambiguous.has(e.timestamp)) {
      facts.unknownMeleeEvents++;
      lastGap = -Infinity;
      continue;
    }
    facts.knownMeleeEvents++;
    if (primary) {
      facts.protectedMeleeEvents++;
      lastGap = -Infinity;
    } else {
      if (e.timestamp - lastGap > 5000) {
        facts.protectionGapEpisodes++;
        if (evidence.length < 3)
          evidence.push({
            fightId: fight.id,
            timestamp: e.timestamp,
            abilityId: 1,
            ability: 'Melee protection review',
            kind: 'tank',
            description: `A melee attempt had no recorded ${profile.primary.join(' / ')} aura. Adjacent hits are grouped into one review episode. This is not proof that a cooldown was available or that this player made a mistake.`,
            confidence: 'observed',
            ruleId: 'tank-primary-aura-observation/v1',
            url: evidenceUrl(report, fight.id, id, e.timestamp, 'damage-taken'),
          });
      }
      lastGap = e.timestamp;
    }
  }
  const alive = aliveIntervals({ ...fight, endTime: end }, life);
  for (const [bin, r] of response) {
    if (recovery.has(bin)) {
      facts.responseKnownWindows!++;
      facts.responseCoveredWindows!++;
      continue;
    }
    if (!r.known) {
      facts.responseUnknownWindows!++;
      continue;
    }
    facts.responseKnownWindows!++;
    if (r.covered || recovery.has(bin)) facts.responseCoveredWindows!++;
  }
  for (const [a, b] of pressure)
    for (const [c, d] of alive) facts.pressureMs += Math.max(0, Math.min(b, d) - Math.max(a, c));
  return { facts, evidence };
}
