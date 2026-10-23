# Tank evidence review and task scoring · engine 0.4.0

## Scope and grading boundary

All six current tank specializations have class-specific evidence profiles. The collector runs on **any completed encounter and difficulty**, including bosses without a hand-written mechanic module. It does not require Sszorak or Blood DK.

This is not a claim that every boss's tank duties can now be graded. The previous live tank index was mostly Tempest avoidance and alive time. It must not be presented as a complete tank performance score. Live tank composite scores, per-boss composite scores and ordinal raid/role positions are therefore withheld. Tanks have a separate overview and inspectable evidence; they are not called the worst raiders because core duties are missing. The synthetic demo's broader scoring example remains explicitly synthetic.

The proposed role categories remain fixed: encounter duties 35%, defensive decisions/resources 30%, personal mechanics 20%, assigned utility 10%, relevant output 5%. These are design hypotheses, **not calibrated scientific weights**. No missing weight is transferred to another category. A complete tank composite requires validated core duty/decision rules and sufficient comparable evidence. Coverage percentages below are measurements, not replacement performance scores.

## Generic task scoring kernel

`shared/tank-scoring.ts` implements the 0–100 calculation independently of class and boss IDs. Only trusted server-side rule adapters may provide scoped task verdicts. A task names its actor, pull, timestamp, incident, versioned rule, category, predeclared opportunity weight and earned fraction. Unverified or unresolved verdicts remain unknown. Buff uptime and raw damage are never automatically converted into verified task verdicts.

Identical incident copies are ignored. Conflicting outcomes, duplicate charges across categories and evidence outside its actor/pull/scoring window are rejected. Within a category, the score is the opportunity-weighted earned fraction. Fixed role weights combine categories; unknown opportunity weight produces explicit lower/upper score bounds and prevents a point grade. A wholly missing category keeps its full weight unknown, rather than handing it to avoidance. These bounds describe missing evidence, **not confidence intervals**.

Per-boss grades are combined with equal boss weighting. An unresolved selected tank boss prevents an overall tank composite; individual verified boss grades can remain visible. No best-of-two rescaling is used. A synthetic player who fulfills 90% of weighted criteria receives 90 even when ranked first. The kernel is tested with all six classes and arbitrary encounter IDs.

**Live availability:** the current importer supplies factual tank observations, not complete verified tank task verdicts. Therefore the acceptance report deliberately has no composite tank score or ordinal tank rank. The kernel and class support are implemented; complete live tank-duty/defensive grading for every boss is not claimed. New boss-rule adapters require independent review and data before they can activate point grades.

## Six class profiles

| Class/spec | Primary aura observed on melee attempts | Important interpretation limit |
|---|---|---|
| Blood Death Knight | Bone Shield | Reactive Death Strike, shields and resource/talent state need separate interpretation. |
| Protection Warrior | Shield Block | Ignore Pain, spell block and damage school are separate context. |
| Protection Paladin | Shield of the Righteous | Spell block, immunities and aggro side effects are not inferred from uptime. |
| Guardian Druid | Ironfur | Stack optimization, shields, weaving and magic talents are not graded. |
| Brewmaster Monk | Shuffle | Stagger ticks are not new enemy attacks; brew charges/CD reduction are not guessed. |
| Vengeance Demon Hunter | Demon Spikes | **100% uptime is not universally required.** Charges, talents, Feed the Demon and alternate defenses matter. |

Names are resolved through the report's translated ability master data and exact class/spec pairs. Protection alone cannot choose warrior versus paladin. Unknown or renamed primary spells produce unknown coverage, not zero. Per-pull specifications take precedence over a mixed report-level label.

## Reproducible measurements

- Melee attempts use WCL's `inCategory("damage")` and ability 1, including misses, dodges and parries. Counting only landed attacks would condition the observation on avoidance and bias the comparison between defensive kits. No numeric hit-type mapping is guessed. Player/friendly-pet damage is excluded; hostile NPC-owned adds remain eligible.
- Initial `combatantinfo` auras establish the starting state. All relevant aura applications, refreshes, stack changes and removals are followed across pages. A melee event sharing a timestamp with a primary aura transition is unknown. Missing initial state is unknown until an actual transition establishes state. Unknown events are explicitly counted and excluded from the percentage denominator.
- Primary coverage is `100 × protected melee events / melee events with known aura state`. It is not a complete mitigation, cooldown-availability, difficulty or skill grade. Full absorption is not mistaken for a miss.
- Adjacent uncovered melee events form review episodes with a maximum five-second gap. A covered or unknown event resets the episode. At most the first three episodes per player/pull enter the evidence list; the aggregate still counts all episodes. These are unscored observations, never stacked hit/death penalties.
- Observed melee pressure is the union of five-second windows following melee attempts, intersected with actual life intervals. This is a disclosed proximity convention, not measured aggro time.
- Large direct hits have effective damage of at least 25% of the target's recorded max HP. The target must be the resource actor. Missing HP is not treated as zero damage or a safe hit. A recorded defensive aura is context; presence alone does not prove school compatibility or optimal timing.
- Catalogue self-heal events count only healing by the player to themself. Overheal and absorb events are excluded. This is not total self-sustain, and larger healing does not earn points.
- Deaths within five seconds of a direct hostile hit are review observations, not blame. Friendly damage and periodic Stagger do not create tank-pressure attacks. Real full-pull totals remain intact when the audited comparison cutoff is selected.
- Shared swaps and vulnerability overlaps remain shared review context until individual responsibility is established. A taunt cast does not prove a successful boss-target change.

## Collection and performance

Combatant snapshots, aura changes, melee attempts and selected tank direct damage/healing are included in the existing single paginated event stream. No extra event scan per tank is needed. Detailed resource fields are requested only for pulls with recognized tank profiles. Only selected tank event fields are retained during processing; gear, coordinates, facing and full resource arrays are not persisted in results. Sorting is per pull, and the same compatible cached facts support whole-report, boss, wipe, kill and individual-pull selections.

Engine/ingestion version 0.3.0 invalidates earlier facts because those imports did not contain the required tank timeline. Score changes never install or update addons or launchers.

## Verification and limits

The real acceptance report is `6fjJxRFC21YHdTXB`: 22 completed pulls, four bosses, two Blood DK tanks and 44 tank/pull observations. Verification compares the new observations against independently reconstructed raw aura states, plus unchanged damage/healing/intake/life/death/Tempest/taunt facts. Whole-report, all 18 Mythic Sszorak wipes and kills-only selections are checked separately.

All six profile paths additionally use labelled synthetic fixtures on arbitrary encounter IDs, covering missing snapshots, same-timestamp transitions, cross-page state, deaths/resurrections, cutoff selection, friendly/pet damage, Stagger and melee misses. **A synthetic test is not live validation of the other five tank specializations.** Complete boss-duty grading and universal individual responsibility are not claimed.

## Primary references

- [WCL API event fields and pagination](https://www.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html), [event/filter semantics](https://www.warcraftlogs.com/help/pins), [initial combatant auras](https://www.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.CombatantInfoEvent.html).
- [Blood DK](https://www.method.gg/guides/blood-death-knight/playstyle-and-rotation), [Protection Warrior](https://www.method.gg/guides/protection-warrior/playstyle-and-rotation), [Protection Paladin](https://www.method.gg/guides/protection-paladin/playstyle-and-rotation), [Guardian](https://www.method.gg/guides/guardian-druid/playstyle-and-rotation), [Brewmaster](https://www.method.gg/guides/brewmaster-monk/playstyle-and-rotation), [Vengeance](https://www.method.gg/guides/vengeance-demon-hunter/talents): firsthand class guides, consulted for class-specific interpretation; not imported as automatic scoring thresholds.
- [Wipefest's public methodology](https://www.archon.gg/classic-fresh/articles/help/how-to-improve-your-raid-with-wipefest) describes why swaps/assignments and unequal opportunities cannot be naively turned into individual scores. Our implementation does not use Wipefest's private code or copy its percentile algorithm.
