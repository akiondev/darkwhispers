/** Original log-review rules. Spell identifiers are factual references, not copied addon code.
 * Sources and evidence limits are carried into every player/pull review.
 */
export const ENCOUNTER_RULE_VERSION = 'midnight-s2/comparable-casts-v2';
export const RAID_DIFFICULTIES = [1, 3, 4, 5, 17] as const;
export type RuleKind =
  | 'avoid'
  | 'ground'
  | 'frontal'
  | 'swap'
  | 'resolve'
  | 'soak'
  | 'interrupt'
  | 'raid'
  | 'context';
export type MechanicRule = {
  id: string;
  name: string;
  kind: RuleKind;
  hits: string[];
  casts: string[];
  aura?: string;
  duration?: number;
  weight: number;
  difficulties?: number[];
  detail: string;
  failure?: string[];
  vulnerabilityIds?: number[];
  hitIds?: number[];
  castIds?: number[];
  /** Only a completed cast explicitly targeting a tank establishes this check. */
  excludeTankCastTarget?: boolean;
  lethalFailure?: boolean;
};
type Entry = { id: number; name: string; slug: string; rules: MechanicRule[] };
const r = (
  name: string,
  kind: RuleKind,
  detail: string,
  options: Partial<MechanicRule> = {},
): MechanicRule => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name,
  kind,
  hits: [name],
  casts: [name],
  weight: ['context', 'raid', 'soak', 'interrupt'].includes(kind) ? 0 : 1,
  detail,
  ...options,
});
export const ENCOUNTERS: Entry[] = [
  {
    id: 3470,
    name: "Nek'zali the Soulcoiler",
    slug: 'the-venomous-abyss/nekzali-the-soulcoiler',
    rules: [
      r('Anguished Echoes', 'avoid', 'Dodge the impact circles.'),
      r(
        'Latent Cultist',
        'context',
        'Spirit-zone contact and initial spawn damage share a family; targeted spawn damage is not a verified personal avoidance failure.',
      ),
      r('Soul Transfer', 'avoid', 'Leave the beam before the channel finishes.', {
        duration: 17000,
      }),
      r(
        'Hollowing Strikes',
        'context',
        'Tank healing-reduction stacks are shown; a strategy threshold is not a universal failure.',
      ),
      r(
        'Possession Barrage',
        'context',
        'Tank distance and interception require position/assignment evidence; raid damage alone is not a tank error.',
      ),
      r(
        'Essence Rend',
        'context',
        'Targeted DoT and dispel placement; application is mandatory, placement responsibility is not inferred.',
      ),
      r(
        'Hungering Pyre',
        'soak',
        'Group soak; Slithering Flame is the intended alternate job, not an automatic missed soak.',
        { hits: ['Hungering Pyre', 'Slithering Flame', 'Cremation'] },
      ),
      r(
        'Soulcoil Well',
        'context',
        'Mythic well teams deliberately enter; do not penalise well damage without assignment evidence.',
      ),
      r(
        "Soulcoiler's Curse",
        'interrupt',
        'Record successful kicks and completed enemy casts as group review; no unassigned personal missed-kick penalty.',
        { difficulties: [5] },
      ),
      r(
        'Grasping Depths',
        'context',
        'Drowned Echo team, well entry and Soul Exhaustion require assignments.',
        {
          difficulties: [5],
          hits: [
            'Grasping Depths',
            'Immortal Coil',
            'Soul Exhaustion',
            'Soulcoiled',
            'Swirling Spirit',
          ],
        },
      ),
      r(
        'Soulcoil Rite',
        'raid',
        'Can be scripted by Ignition/Invoke or caused by adds; never attribute all Rite damage to an individual.',
        {
          hits: [
            'Soulcoil Rite',
            'Ritual Burn',
            'Soulcoil Ignition',
            'Corpse Blight',
            'Uncoiled Rage',
            'Uncoiling',
            'Invoke',
            'Restless Amani',
            'Gravebound Advance',
          ],
        },
      ),
    ],
  },
  {
    id: 3445,
    name: 'Entombed Sentinels',
    slug: 'the-venomous-abyss/entombed-sentinels',
    rules: [
      r('Living Venom', 'avoid', 'Avoid the outgoing and returning lines.', {
        difficulties: [4, 5],
        casts: ['Toxic Droplets'],
        castIds: [1284434],
        hitIds: [1284209],
        duration: 30000,
      }),
      r('Blood Venom', 'ground', 'Avoid the pool; necessary marked-player DoT is separate.'),
      r(
        'Helical Toxins',
        'resolve',
        'Pair to neutralise toxins. Cultivated Burst is a failed resolution; deaths/cutoffs before resolution are unknown.',
        { failure: ['Cultivated Burst'], duration: 30000, weight: 2 },
      ),
      r(
        'Shifting Protovenom',
        'context',
        'Protovenom Eruption proves a bad pairing, but does not identify which partner caused it.',
        { difficulties: [5], hits: ['Shifting Protovenom', 'Protovenom Eruption'] },
      ),
      r(
        'Toxic Droplets',
        'soak',
        'Orb pickup is required; only Noxious Blast identifies an uncollected orb at raid level.',
        { hits: ['Toxic Droplets', 'Noxious Blast'] },
      ),
      r('Unstable Miasma', 'soak', 'Required group soak; no punishment for taking its damage.', {
        hits: ['Unstable Miasma', 'Clinging Murk'],
      }),
      r(
        'Empowering Slam',
        'context',
        'Tanks trade golems at intermission; repeated slams within one phase are expected.',
      ),
      r(
        'Bloodvenom Injection',
        'context',
        'Tank stacks and expiry placement are reviewed; repeated casts in one phase are expected.',
      ),
      r(
        'Sentinel coordination',
        'raid',
        'Boss separation and HP balance need position/health timelines; mandatory marks are not avoidance errors.',
        {
          hits: [
            "Ula'tek's Dominance",
            'Vitriolic Stasis',
            'Mark of Acid',
            'Mark of Blood',
            'Venom Coagulation',
            'Contaminate',
            'Blighted Blood',
          ],
        },
      ),
    ],
  },
  {
    id: 3455,
    name: 'Vashnik the Malignant',
    slug: 'the-venomous-abyss/vashnik-the-malignant',
    rules: [
      r(
        'Plague Wave',
        'avoid',
        'Avoid the cross-shaped waves. A hit proves contact, not who aimed the wave.',
        { casts: ['Plague Froth'] },
      ),
      r('Umbral Ejection', 'avoid', 'Avoid the shadow add death impacts.'),
      r(
        'Deadly Venom',
        'ground',
        'Avoid damaging floor zones; debuff applications from other mechanics are not used.',
        { hits: ['Deadly Venom'] },
      ),
      r(
        'Dripping Fangs',
        'swap',
        'A fresh bite with the previous physical vulnerability active is a tank-pair swap review.',
        { aura: 'Dripping Fangs', vulnerabilityIds: [1280934], weight: 2 },
      ),
      r(
        'Malignant Catalyst',
        'soak',
        'Catalytic Bile needs coverage. Record hits without inventing individual soak assignments.',
        { hits: ['Malignant Catalyst', 'Catalytic Bile'] },
      ),
      r(
        'Adaptive Infection',
        'context',
        'Blood requires company, Shadow requires separation, Fire requires staggered dispels. Debuff application is mandatory.',
        {
          hits: [
            'Adaptive Infection',
            'Siphoning Infection',
            'Siphon Blood',
            'Stygian Infection',
            'Stygian Burst',
            'Exploding Infection',
            'Caustic Explosion',
          ],
        },
      ),
      r(
        'Malignant Burst',
        'raid',
        'An add reached the cavity. Review add control; damage recipients are not automatically responsible.',
      ),
      r(
        'Malignance',
        'raid',
        'An uncleared Mythic totem erupted. Wave ownership and routing need assignments.',
        { difficulties: [5] },
      ),
      r(
        'Fountain management',
        'context',
        'Fountain routing, add priority and staggered deaths are strategy context; no fixed fountain order is imposed.',
        {
          hits: [
            'Imbibe',
            'Toxic Vapor',
            'Burning Presence',
            'Caustic Surge',
            'Plague Froth',
            'Hardened Venom',
            'Splitting Clot',
            'Sanguineous Fortitude',
            'Miasmic Coating',
            'Congealing Bolt',
            'Gloom Expulsion',
            'Conflagrating Expulsion',
            'Virulent Fumes',
          ],
        },
      ),
    ],
  },
  {
    id: 3497,
    name: 'The Lost Explorers',
    slug: 'the-venomous-abyss/the-lost-explorers',
    rules: [
      r('Evil Eyes', 'avoid', 'Avoid spirit-flame impacts.'),
      r('Shell Spin', 'avoid', 'Avoid the spinning turtle and stun.'),
      r('Blast Wave', 'avoid', 'Jump or use a movement tool over the wave.', {
        hits: ['Blast Wave', 'Spreading Flames'],
        weight: 2,
      }),
      r('Aftershock', 'ground', 'Leave the thud craters.', { difficulties: [4, 5] }),
      r(
        'Icebound Flames',
        'interrupt',
        'Track actual interrupts; a completed cast is group context, not a missed kick assigned to everyone.',
      ),
      r(
        'Frostfire Volley',
        'context',
        'Opposite patches clear the targeted debuff. Patch contact can be required; Elemental Explosion is reviewed without guessing its owner.',
        {
          hits: [
            'Frostfire Volley',
            'Burning Flames',
            'Piercing Frost',
            'Frost Patch',
            'Fire Patch',
            'Elemental Explosion',
          ],
        },
      ),
      r(
        'Shredding Shards',
        'swap',
        'Review a new shard sequence with prior vulnerability, not the separate shards inside one sequence.',
        { aura: 'Shredding Shards', vulnerabilityIds: [1295858], weight: 2 },
      ),
      r(
        'Steady Strikes',
        'context',
        'Tank ramp, boss positioning and HP balance are shown; no arbitrary stack threshold is imposed.',
      ),
      r(
        'Mighty Thud',
        'soak',
        'Share marked impacts. Missed raid soaks do not establish individual non-soaker fault.',
      ),
      r(
        'Crates and fish',
        'context',
        'Crate damage and Splinters may be assigned work, especially Mythic. Record ruptures and fish casts as context.',
        {
          hits: [
            'Throw Junk',
            'Splinters',
            'Relic Rupture',
            'Disgusting Fish',
            'Fling Fish',
            'Final Ascension',
            'Dark Whispers',
            "Mor'zahi's Command",
            'Fishy Feedback',
            'Mushroom Toss',
            'Fungal Burst',
            'Bounce',
            'Explosive Surprise',
            'Blink Nova',
            'Malevolent Presence',
            'United Defense',
            'Smashing Shovel',
            'Cataclysmic Invocation',
            'Violent Temper',
          ],
        },
      ),
    ],
  },
  {
    id: 3420,
    name: 'Sszorak',
    slug: 'the-venomous-abyss/sszorak',
    rules: [
      r(
        'Tempest',
        'avoid',
        'Avoid direct contact; periodic ticks excluded. One failure maximum per observed cast window.',
        { duration: 58500, hitIds: [1287083] },
      ),
      r('Caustic Residue', 'ground', 'Avoid residue contact; cyst bounce itself is required.', {
        difficulties: [4, 5],
      }),
      r(
        'Ravage',
        'swap',
        'Tank-only frontal: review a new hit with prior vulnerability. Non-tanks should avoid the frontal.',
        { aura: 'Ravage', vulnerabilityIds: [1277105], hitIds: [1277101], weight: 2 },
      ),
      r(
        'Mutilate',
        'swap',
        'Required group contact. Repeated contact with Mutilated Gash is a vulnerable-soak review, not a penalty for all non-soakers.',
        {
          hits: ['Mutilate'],
          aura: 'Mutilated Gash',
          vulnerabilityIds: [1285998, 1277051],
          weight: 2,
        },
      ),
      r(
        'Corroding Venom',
        'context',
        'Tank stacks are visible; a suggested swap threshold is not an encounter-defined failure.',
        { hits: ['Corroding Venom', 'Caustic Claws'] },
      ),
      r(
        "Serpent's Fury",
        'soak',
        'Mythic assignment/soak and facing. Required Virulence/soak damage is not generic avoidable damage.',
        {
          difficulties: [5],
          hits: ["Serpent's Fury", 'To the Slaughter', 'Virulence', 'Unbound Ferocity'],
        },
      ),
      r(
        'Wind and cysts',
        'context',
        'Marked movement, cyst placement, partner collisions and intentional cyst bounces need positioning/assignments.',
        {
          hits: [
            'Apex Predator',
            'Venomous Surge',
            'Raging Crosswinds',
            'Turbulent Gusts',
            'Viscous Cyst',
            'Howling Maelstrom',
            'Dig In',
            "Ula'tek's Presence",
          ],
        },
      ),
    ],
  },
  {
    id: 3421,
    name: 'The Twin Fangs',
    slug: 'the-venomous-abyss/the-twin-fangs',
    rules: [
      r('Vile Flood', 'avoid', 'Avoid the sweeping laser.'),
      r('Sanguine Storm', 'avoid', 'Avoid impact circles.'),
      r(
        'Stir the Depths',
        'context',
        'The raid pulse is unavoidable; only the separate wave-contact spell can be an avoidance check.',
      ),
      r(
        'Stir the Depths waves',
        'avoid',
        'Avoid the separate wave-contact effect; the mandatory raid pulse is excluded.',
        {
          hits: ['Stir the Depths'],
          casts: ['Stir the Depths'],
          hitIds: [1292807],
          duration: 10000,
        },
      ),
      r('Noxious Slick', 'ground', 'Avoid the residual floor zones.'),
      r(
        'Ravenous Feast',
        'swap',
        'Required soak, but a second strike with Feasted active cannot remove venom and is a vulnerable-soak failure.',
        { aura: 'Feasted', vulnerabilityIds: [1310096], weight: 2 },
      ),
      r(
        'Caustic Deluge',
        'context',
        'Tank channel stacks Envenomed; channel ticks are required. Review swaps between sequences.',
        { hits: ['Caustic Deluge', 'Envenomed', 'Concentrated Spittle'] },
      ),
      r('Stone Breaker', 'soak', 'Tanks alternate swirly sets; assigned hits are required.'),
      r(
        'Caustic Globule',
        'soak',
        'Collect globules; Eternal Venom contains unavoidable and avoidable sources and is never a generic personal mistake.',
        {
          hits: [
            'Caustic Globule',
            'Eternal Venom',
            'Barbed Bulwark',
            'Venomous Emergence',
            'Corrosive Spit',
            'Coiling Ichor',
            'Congealed Gore',
          ],
        },
      ),
      r(
        'Visceral Burst',
        'interrupt',
        'Mythic brood casts need kicks; credit observed interrupters, review completed casts as raid incidents.',
        { difficulties: [5], hits: ['Visceral Burst', 'Rouse the Brood'] },
      ),
      r(
        'Tainted Blood',
        'soak',
        'Mythic healing-absorb pools require soaking; Tainted Burst is the group failure.',
        { difficulties: [5], hits: ['Tainted Blood', 'Tainted Burst', 'Blood Torrent'] },
      ),
      r(
        'Submerge',
        'raid',
        'Rotation, forced raid pressure, paired boss deaths and enrage are reviewed without assigning victim blame.',
        { hits: ['Submerge', 'Toxic Fumes', 'Uncoiled Wrath', 'Clotted Bolt'] },
      ),
    ],
  },
  {
    id: 3429,
    name: 'The Coiled Altar',
    slug: 'the-venomous-abyss/the-coiled-altar',
    rules: [
      r('Axegrinder', 'avoid', 'Avoid moving axes.'),
      r('Noxious Ground', 'ground', 'Leave altar-mouth pools.'),
      r('Defiled Ground', 'ground', 'Avoid the defiled floor.', { difficulties: [4, 5] }),
      r(
        'Sever',
        'swap',
        'Tank frontal and cleanup tool. New hit with previous vulnerability is reviewed; non-tanks avoid the cone.',
        { aura: 'Sever', vulnerabilityIds: [1301690], hitIds: [1299684], weight: 2 },
      ),
      r(
        'Soul Sever',
        'swap',
        'Tank frontal clears ghosts. Review new strikes with prior vulnerability; Gravebound requires fragment collection.',
        { aura: 'Soul Sever', vulnerabilityIds: [1307959], hitIds: [1286620], weight: 2 },
      ),
      r(
        'Gravebound',
        'resolve',
        'Collect the soul fragments before expiry. Only a recorded lethal Gravebound event fails this check; ordinary Gravebound damage is not a failure.',
        { failure: ['Gravebound'], lethalFailure: true, duration: 17000, weight: 2 },
      ),
      r(
        'Guillotine',
        'swap',
        'Group soak is required. Re-soaking while Guillotined is active is reviewed; do not penalise the initial hit.',
        { aura: 'Guillotine', vulnerabilityIds: [1307425], hitIds: [1283594], weight: 2 },
      ),
      r(
        'Grim Guillotine',
        'soak',
        'Fused soak/positioning; immunities and assignments are context.',
        {
          hits: [
            'Grim Guillotine',
            'Guillotined',
            "Widow's Kiss",
            "Widow's Touch",
            "Death's Embrace",
            'Execution',
          ],
        },
      ),
      r(
        'Wail of Terror',
        'interrupt',
        'Kicks and completed add casts are logged. Correct timing depends on the raid plan.',
      ),
      r(
        'Toxin cleanup',
        'context',
        'Orb carriers and tank frontals intentionally create Venom Rupture. Mythic collision eruptions need ownership/position evidence.',
        {
          hits: [
            'Toxic Deluge',
            'Coalesced Venom',
            'Volatile Venom',
            'Mutagenic Venom',
            'Virulent Mutation',
            'Venom Rupture',
            'Venomfang',
            'Twinfang Toxin',
            'Fangs of the Coiled Altar',
            'Blighted Sever',
          ],
        },
      ),
      r(
        'Soul management',
        'context',
        'Gloombomb, ghost cleanup, possession, shield damage and intermission soaks require separate assignments; affected players are not automatically at fault.',
        {
          hits: [
            'Dreadmarch',
            'Unnerving Fixation',
            'Spiritcackle',
            'Gloombomb',
            'Malevolent Resonance',
            'Eternal Nightfall',
            'Veil of Twilight',
            'Suffocating Darkness',
            'Soulbinding',
            'Spirit Erasure',
            'Dreadful Presence',
            'Dread Bolt',
            'Retaliatory Malice',
            'Reclaim Essence',
            'Ghastly Regeneration',
            'Defilement of the Coiled Altar',
            'Corrupted Toxin',
            'Soulbound',
            'Spirit Erasure',
          ],
        },
      ),
    ],
  },
  {
    id: 3492,
    name: "Ula'tek",
    slug: 'the-venomous-abyss/ulatek',
    rules: [
      r('Caustic Waves', 'avoid', 'Avoid wave contact; carried eggs must also be protected.'),
      r('Falling Debris', 'avoid', 'Avoid the falling impacts.'),
      r('Virulent Spit', 'avoid', 'Avoid the targeted impact zones.'),
      r(
        "Mother's Wrath",
        'context',
        'Keep a tank in melee; raid-wide punishment is a shared tank-coverage incident, not victim fault.',
        {
          hits: [
            "Mother's Wrath",
            'Stone Venom',
            'Hobbled',
            'Unchecked Rage',
            'Gore Rattle',
            'Rattler Slam',
            'Mephitic Thrash',
          ],
        },
      ),
      r(
        'Anguished Cry',
        'interrupt',
        'Record successful interrupts and dangerous completed add casts.',
        { hits: ['Anguished Cry', 'Malice', 'Vicious Echoes', 'Dread Roar'] },
      ),
      r(
        'Spectral Coils',
        'soak',
        'Alternate assigned teams. Required damage and Soul Constrictor are not avoidance failures.',
        { hits: ['Spectral Coils', 'Soul Constrictor'] },
      ),
      r(
        "Serpent's Bite",
        'soak',
        'Assigned bites need group soaks; Calcified Corpse signals an unresolved bite without assigning all raid members fault.',
        { hits: ["Serpent's Bite", 'Ingested Venom', 'Calcified Corpse', 'Volatile Purge'] },
      ),
      r(
        'Egg and add control',
        'context',
        'Carrier overlap, clean hatches, cauldron routing and add priority need ownership and assignments. Egg damage/bleeds can be required.',
        {
          hits: [
            'Call of the Serpent',
            'Malignant Shell',
            'Noxious Shell',
            'Noxious Splash',
            'Rancid Yolk',
            'Putrid Membrane',
            'Poisonous Bite',
            'Acidic Burst',
            'Petrifying Sting',
            "Warden's Protection",
            'Grasping Fangs',
            'Blight Vein',
            'Writhing Gestation',
            'Mass Gestation',
            'Doomscale Shell',
            'Doomscale Cauldron',
            'Boiling Venom',
            'Shadow Molt',
            'Desperate Thrash',
            'Greasy Hatchling',
            'Butter Fingers',
            'Toxic Incubation',
            'Toxic Womb',
            'Blightscale Clutch',
            'Acidic Expulsion',
            'Fester Burst',
          ],
        },
      ),
      r(
        'Phase pressure',
        'raid',
        'Unavoidable raid pressure, burn windows and platform transitions are not personal failures.',
        {
          hits: [
            'Rage of the Shackled',
            'Venomous Heart',
            'Necrotic Vapors',
            'Submerge',
            'Circling Prey',
            'Fury Unleashed',
            'Rage of the Shackled',
          ],
        },
      ),
    ],
  },
  {
    id: 3379,
    name: 'Nymrissa Wavecaller',
    slug: 'the-tidebound-grotto/nymrissa-wavecaller',
    rules: [
      r('Swirling Whirlpools', 'avoid', 'Move into the safe gap.'),
      r(
        'Lingering Frost',
        'context',
        'Frost pools may be deliberately cleared by Mythic tank frontal. Contact alone cannot establish unnecessary exposure.',
      ),
      r(
        'Iceblade Flurry',
        'swap',
        'Swap between flurry sequences with prior vulnerability, not between ticks.',
        {
          aura: 'Iceblade Flurry',
          vulnerabilityIds: [1282947],
          hitIds: [1282945],
          difficulties: [1, 3, 4, 17],
          weight: 2,
        },
      ),
      r(
        'Water Jet',
        'swap',
        'Mythic tank frontal clears ice; review new hits with prior vulnerability and non-tank frontal contact.',
        { aura: 'Water Jet', vulnerabilityIds: [1260637], difficulties: [5], weight: 2 },
      ),
      r(
        'Frost Orb',
        'soak',
        'Orb pickups are required; Shatter is an uncollected-orb raid incident. Frost Burst can be unavoidable.',
        { difficulties: [4, 5], hits: ['Frost Orb', 'Chilling Frost', 'Shatter', 'Frost Burst'] },
      ),
      r(
        'Bubble and adds',
        'context',
        'Bubblefin transformations and Mythic Frostscale shield are add-control context; Pop! and Rain are mandatory damage.',
        {
          hits: [
            'Alluring Bubble',
            'Pulsing Tides',
            'Waterfog Shield',
            'Pop!',
            'Abyssal Rain',
            "Wavecaller's Might",
            'Unending Tides',
          ],
        },
      ),
    ],
  },
  {
    id: 3513,
    name: "Kith'ix",
    slug: 'the-unbinding-of-kithix/kithix',
    rules: [
      r('Twisted Appendage', 'avoid', 'Avoid the tentacle paths.'),
      r(
        'Dark Devastation splash',
        'avoid',
        'Avoid the impact around the explicitly marked tank. The marked tank has no avoidance check; both damage components count as one contact.',
        {
          hits: ['Dark Devastation'],
          casts: ['Dark Devastation'],
          castIds: [1304930],
          hitIds: [1304946, 1304947],
          excludeTankCastTarget: true,
          duration: 10000,
        },
      ),
      r('Voidscar', 'ground', 'Avoid scars; tank placement and fragment soaks are separate jobs.', {
        difficulties: [4, 5],
      }),
      r(
        'Suffocation',
        'ground',
        'Remain inside the intermission safe zone. Forced pulls are reviewed without attributing movement cause.',
      ),
      r(
        'Venom Roar',
        'frontal',
        'Tank the Hulk cone away from the raid; its tank contact is required.',
      ),
      r(
        'Dark Devastation',
        'swap',
        'Tank pair swaps each cast. Re-hit with Devastated active is reviewed; splash responsibility needs position evidence.',
        { aura: 'Devastated', vulnerabilityIds: [1304948], hitIds: [1304946], weight: 2 },
      ),
      r(
        'Negation',
        'resolve',
        'Tank must clear Null Gates before the lethal expiry; Mythic requires three clears.',
        { failure: ['Negation'], lethalFailure: true, duration: 14000, weight: 3 },
      ),
      r(
        'Extinguish',
        'context',
        "Verify Light's Embrace or an immunity in the event timeline; survival alone does not prove correct mote timing.",
        { hits: ['Extinguish', "Light's Embrace"] },
      ),
      r(
        'Null Gate',
        'context',
        'Marked gate placement and shards require ownership evidence; Negation tanks deliberately run through gates.',
        { hits: ['Null Gate', 'Nullshards', 'Nullify', 'Explosive Restabilization'] },
      ),
      r(
        'Light and fears',
        'context',
        'Fear dispel distance, healing absorbs and fragment interception need positions/assignments.',
        {
          hits: [
            'Unspeakable Horrors',
            'Overwhelming Fear',
            'Abyssal Grasp',
            'Eclipse Fragment',
            'Lost Refulgence',
            'Refulgent Bulwark',
          ],
        },
      ),
      r(
        'Swarm and phase pressure',
        'raid',
        'Adds need control and staggered explosions; raid pulses are not personal avoidance errors.',
        {
          hits: [
            'Voidswarm',
            'Commanding Presence',
            'Voidweave',
            'Nightfall',
            'Gut Reaction',
            'Digestive Juices',
            'Incubation',
            'Hatch',
            'Mindsting',
            'Dark Frenzy',
            'Suffocating Darkness',
            'Divine Radiance',
            'Exhausted',
            'Stygian Howl',
            'Last Light',
            'Luminous Grace',
            'Eightfold Eclipse',
          ],
        },
      ),
    ],
  },
];
export const encounterFor = (id: number) => ENCOUNTERS.find((e) => e.id === id);
export const ruleSource = (entry: Entry) => `https://www.method.gg/guides/${entry.slug}`;
export const normaliseSpell = (name: string) => name.toLowerCase().replace(/[’‘]/g, "'").trim();
