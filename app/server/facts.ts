import type { Fight, PlayerFacts } from '../shared/types.js';

type Event = Record<string, any>;
// Positive observations only. A catalogue miss never becomes a preparation failure.
// These IDs/names were verified in the supplied Midnight S2 reports. The catalogue
// is deliberately small; newly added items remain visible by their actual cast name.
const FLASKS = new Map<number, string>([
  [1235111, 'Flask of the Shattered Sun'],
  [1235108, 'Flask of the Magisters'],
  [1235110, 'Flask of the Blood Knights'],
  [1235057, 'Flask of Thalassian Resistance'],
  [432473, 'Flask of Saving Graces'],
  [432021, 'Flask of Alchemical Chaos'],
]);
const FOOD = new Set([
  1294727, 1232585, 1305150, 1233724, 1284616, 451920, 1285644, 1305155, 1232490, 1284618, 451916,
  451918, 1219182, 1284617, 1232086, 1305154, 457284, 1232076, 451917, 1233703, 1219185, 1233408,
  1305153, 1233732, 1232317, 1305152, 1232078,
]);
const POTIONS = new Map<number, { name: string; kind: 'combat-potion' | 'healing-potion' }>([
  [1236994, { name: 'Potion of Recklessness', kind: 'combat-potion' }],
  [1295247, { name: 'Concentrated Silvermoon Health Potion', kind: 'healing-potion' }],
  [1262857, { name: 'Potent Healing Potion', kind: 'healing-potion' }],
  [1234768, { name: 'Silvermoon Health Potion', kind: 'healing-potion' }],
]);
const HEALTHSTONES = new Map<number, string>([
  [6262, 'Healthstone'],
  [452930, 'Demonic Healthstone'],
]);
const positiveInt = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0;
function auraId(aura: Event): number {
  if (typeof aura.ability === 'number') return positiveInt(aura.ability);
  const ability = aura.ability && typeof aura.ability === 'object' ? aura.ability : {};
  return (
    positiveInt(ability.gameID) ||
    positiveInt(ability.guid) ||
    positiveInt(ability.id) ||
    positiveInt(aura.abilityGameID)
  );
}
function nameMatches(abilities: Map<number, string>, id: number, expected: string): boolean {
  return abilities.get(id)?.toLowerCase() === expected.toLowerCase();
}
export function emptyFacts(): PlayerFacts {
  return { snapshot: false, activeAtPull: [], consumables: [], lifeEvents: [], casts: 0 };
}
/** Retains tiny positive facts, never raw gear/stat/resource arrays or guessed availability. */
export function factRecorder(fight: Fight, actors: number[], abilities: Map<number, string>) {
  const facts = new Map(actors.map((id) => [id, emptyFacts()]));
  const castKeys = new Set<string>();
  const snapshotActors = new Set<number>();
  return {
    facts,
    observe(events: Event[]) {
      for (const e of events) {
        const fact = facts.get(e.sourceID);
        if (!fact || typeof e.timestamp !== 'number' || !Number.isFinite(e.timestamp)) continue;
        if (e.type === 'cast' && e.timestamp >= fight.startTime && e.timestamp <= fight.endTime) {
          const id = positiveInt(e.abilityGameID) || positiveInt(e.ability?.guid);
          const key = `${e.sourceID}:${id}:${e.timestamp}`;
          if (castKeys.has(key)) continue;
          castKeys.add(key);
          fact.casts++;
          let kind: PlayerFacts['consumables'][number]['kind'] | undefined;
          let name = '';
          const stone = HEALTHSTONES.get(id),
            potion = POTIONS.get(id);
          if (stone && nameMatches(abilities, id, stone)) {
            kind = 'healthstone';
            name = stone;
          }
          if (potion && nameMatches(abilities, id, potion.name)) {
            kind = potion.kind;
            name = potion.name;
          }
          if (!kind) continue;
          const existing = fact.consumables.find((row) => row.id === id);
          if (existing) existing.uses++;
          else fact.consumables.push({ id, name, kind, uses: 1 });
        }
        if (
          e.type !== 'combatantinfo' ||
          snapshotActors.has(e.sourceID) ||
          e.timestamp < fight.startTime - 1 ||
          e.timestamp > fight.startTime + 2000
        )
          continue;
        // A missing/malformed aura snapshot is not interpreted as an empty buff list.
        if (!Array.isArray(e.auras)) continue;
        snapshotActors.add(e.sourceID);
        fact.snapshot = true;
        // The API describes a set of starting auras, not a guaranteed complete
        // inventory of every present/future consumable. An empty array or a new
        // unrecognised spell cannot prove that food/flask was absent. Keep the
        // two checks explicit so composite scoring can retain the unverified
        // portion of its fixed preparation weight instead of awarding it.
        fact.preparation = {
          flask: 'unknown',
          food: 'unknown',
          basis: 'Verified pull-start buff ID and name. Unmatched preparation remains unverified.',
        };
        const seen = new Set<number>();
        for (const raw of e.auras) {
          if (!raw || typeof raw !== 'object') continue;
          const id = auraId(raw),
            name = abilities.get(id);
          if (!id || !name || seen.has(id)) continue;
          seen.add(id);
          const flask = FLASKS.get(id),
            potion = POTIONS.get(id);
          let category: PlayerFacts['activeAtPull'][number]['category'] | undefined;
          if (flask && nameMatches(abilities, id, flask)) category = 'flask';
          if (FOOD.has(id) && /^(hearty )?well fed$/i.test(name)) category = 'food';
          if (potion?.kind === 'combat-potion' && nameMatches(abilities, id, potion.name))
            category = 'combat-potion';
          if (category) {
            fact.activeAtPull.push({ id, name, category });
            if (category === 'flask' || category === 'food') fact.preparation[category] = 'present';
          }
        }
        if (Array.isArray(e.gear)) {
          const enchants: NonNullable<PlayerFacts['enchantsObserved']> = [];
          const gems: NonNullable<PlayerFacts['gemsObserved']> = [];
          e.gear.forEach((item: Event, index: number) => {
            if (!item || typeof item !== 'object') return;
            const itemId = positiveInt(item.id),
              enchantId = positiveInt(item.permanentEnchant);
            if (!itemId) return;
            // WCL's gear array is ordered by one-based equipment slot. Retain only
            // positive enchant observations; no mandatory-slot or full-enchanted claim.
            if (enchantId) enchants.push({ slot: index + 1, itemId, enchantId });
            if (Array.isArray(item.gems))
              for (const gem of item.gems) {
                const gemId = gem && typeof gem === 'object' ? positiveInt(gem.id) : 0;
                if (gemId) gems.push({ slot: index + 1, itemId, gemId });
              }
          });
          fact.enchantsObserved = enchants;
          fact.gemsObserved = gems;
        }
      }
    },
  };
}

/** Raw v2 uses `feign`; normalized event producers may expose `isFeign`. */
export function recordedLifeEvent(e: Event): 'death' | 'resurrect' | null {
  if (e.type === 'resurrect') return 'resurrect';
  if (e.type !== 'death' || e.feign === true || e.isFeign === true) return null;
  // A real death can carry metadata about an EARLIER save. Do not discard it:
  // https://www.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.DeathEvent.html
  return 'death';
}
