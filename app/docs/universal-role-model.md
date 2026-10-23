# Universal raid role index · 0.5.0

Historical factor-method reference. Version 0.6.0 expands encounter rules, per-pull explanations and role-separated standings; see [the current S2 rule inventory](midnight-s2-rules.md). The old Tempest-only mechanic scope and tank-mechanic withholding described below no longer define current rule coverage. The fixed-factor formulas and missing-evidence policy remain applicable.

## Scope

All completed raid encounters and difficulty IDs use the same engine. There is no encounter allowlist for the role index. The Midnight Season 2 acceptance matrix covers all ten The Venomous Abyss encounters: Kith'ix (3513), Nek'zali (3470), Entombed Sentinels (3445), Vashnik (3455), The Lost Explorers (3497), Sszorak (3420), The Twin Fangs (3421), The Coiled Altar (3429), Ula'tek (3492) and Nymrissa Wavecaller (3379). Warcraft Logs raid difficulty IDs 1/3/4/5 represent LFR/Normal/Heroic/Mythic; 17 is accepted as an LFR alias. All six tank class profiles are exercised on all ten IDs and all four raid difficulties with labelled synthetic fixtures. Real-log validation covers Heroic and Mythic, not a claim of live LFR/Normal validation.

Every participant receives a numerical **provisional role index** and raid/role position, including tanks, mixed-role actors and short attendance. A small or missing sample stays visible through measured weight, bounds and confidence. Missing boss attendance is never a zero. Scores describe measured fulfilment of declared role factors; they do not establish complete player skill, individual fault or optimal cooldown/resource decisions.

## Research and design decisions

[Warcraft Logs ranking documentation](https://classic.warcraftlogs.com/help/ranks/) describes class/spec kill parses and historical comparisons. An actual API probe against the acceptance Mythic wipe returned an empty rankings array. Wipes therefore do not receive fabricated kill percentiles or cross-class raw-DPS substitutes. The API exposes [tables](https://www.warcraftlogs.com/v2-api-docs/warcraft/tabledatatype.doc.html) and paginated [events](https://cn.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html); filtered casts, life events, tank auras, relevant self-recovery and incoming pressure share one bounded event stream.

[Wipefest's published method](https://www.archon.gg/wow/articles/help/how-to-improve-your-raid-with-wipefest) uses explicit mechanic definitions and reference samples. Unequal-opportunity actions and tank swaps are not universally treated as ordinary avoidable errors. We retain that distinction: successful utility counts are visible, but unassigned interrupts/dispels do not grant points or imply missed assignments. Unrecognised damage/debuffs never automatically become mistakes. This index is our own deterministic design, not a copy of Wipefest's proprietary scoring or a claim to its population dataset.

Blood DK [maintenance and reactive recovery](https://www.method.gg/guides/blood-death-knight/playstyle-and-rotation) differ from [Vengeance's layered defensive kit](https://www.method.gg/guides/vengeance-demon-hunter/playstyle-and-rotation). Tank response therefore considers class-specific primary auras, personal physical responses, effective catalogue self-recovery and attacker-specific Fiery Brand, rather than demanding one identical buff or rewarding a raw self-heal total. Abilities/talent expectations change; observed response does not prove optimal use or availability.

## Fixed role weights

| Factor | Damage | Healer | Tank |
| --- | ---: | ---: | ---: |
| Time alive | 30 | 35 | 30 |
| Action continuity | 20 | 15 | 15 |
| Historical class/spec kill output | 30 | 30 | 10 |
| Tank response under melee exposure | 0 | 0 | 25 |
| Verified applicable mechanics | 20 | 20 | 20 |

These are transparent product design weights, not scientifically calibrated estimates of skill. The role of each pull is determined from that pull's specialization. Mixed-role contexts are evaluated separately. Unknown role keeps role-dependent factors unknown rather than inventing a spec.

For each factor with base weight `w`, observed score `s` (0–100) and usable fraction `q` (0–1):

```
measuredWeight = w × q
measuredPoints = measuredWeight × s / 100
neutralPoints = (w − measuredWeight) / 2
index = sum(measuredPoints + neutralPoints)
lower = sum(measuredPoints)
upper = lower + 100 − sum(measuredWeight)
```

Unknown weight remains explicitly at the midpoint 50. Those neutral points are **not facts about good performance**. The displayed lower/upper range assigns unknown weight 0–100; it is not a statistical confidence interval or a bound on all unmodelled aspects of true skill. This avoids turning survival-only data into a verified perfect grade or forcing missing weight to zero. The midpoint permits provisional ordering while the range shows when small differences are unresolved. Rank does not imply that overlapping ranges establish a better player. Partial rules always retain `~`; the gold complete 100 badge is never awarded to a partial live index.

## Measurements and denominator safety

* **Survival:** time alive / time actually measured, including battle resurrections and excluding Feign Death. Missing measurements are unknown. Samples shorter than one minute have proportional usable weight. Early deaths cost more time; death does not establish fault.
* **Continuity:** an actor has an action in a ten-second window. The window is eligible only with another living same-role participant and either the actor's own action or actions by at least 25% of other living same-role peers. Shared quiet windows are excluded; ten eligible windows are needed for full usable activity weight. Alive milliseconds are intersected with each window. Cast spam adds no credit; channels, movement, assignments, heal demand and solo roles still limit interpretation. A sole-role participant has unknown continuity rather than an invented inactivity penalty.
* **Output:** historical DPS percentile for damage/tanks and HPS percentile for healers, each matched to class/spec on its own kill. Percentiles are averaged only across actual available kill benchmarks. The usable fraction is benchmarked pulls / selected pulls in that context. Missing another actor's parse cannot erase a known actor's parse. Different class raw DPS, raw HPS and overheal are not interchangeable with benchmark evidence.
* **Tank response:** five-second windows containing hostile melee attempts, including parries/misses. Known windows either have personal physical response coverage on their attempts or effective catalogue self-recovery in that window. Missing snapshots, unresolved aura state and simultaneous transitions remain unknown unless a positive response is independently recorded. At least twenty known windows are needed for full sample weight, multiplied by the known-state fraction. Off-tank downtime does not create a negative opportunity. Anti-Magic Shell is not a physical response; external cooldowns, total damage taken, raw self-heal size and overheal earn no points. Recovery is an observed response, not proof that a heal was necessary or optimally timed.
* **Mechanics:** only a versioned, applicable rule with verified opportunities supplies a grade. At least ten opportunities are needed for full sample weight, and unmeasured pull time remains unknown. Tempest's exact encounter/spell identity supports the same direct-contact rule on all raid difficulties where that timeline exists. Repeated hits count at most once per cast window; periodic ticks and misses/immunities are excluded. Generic Tempest avoidance is not used to judge tank assignments. This does **not** claim that every mechanic on every boss has a hand-authored failure rule; the universal role index remains available independently.

Difficulty and role contexts are evaluated separately. Roles within a difficulty are weighted by attended pull count. Difficulties within a boss, then all selected bosses within a report, receive equal weight; many wipes on one boss cannot dominate ten different bosses. Unattended bosses are explicit unknown midpoint weight and bounds, never zeroes; one easy attended boss cannot masquerade as measured excellence across ten. The UI labels those unplayed boss rows. Short attendance is disclosed and ranked rather than filtered out, and limited evidence is not labelled poor play. Confidence reflects measured weight, sample and participation; coverage is not a measure of all boss mechanics checked.

## Wipe and snapshot policy

When enabled, terminal sustained 50% mortality for at least five seconds supplies a generic raid-collapse comparison cutoff. Temporary recovery cancels that cutoff. Kills retain their full duration. A specifically verified Sszorak Mythic enrage may supply an earlier cutoff. This is a disclosed comparison convention, not a detected voice call; full damage/healing and deaths remain visible. Activity, survival, tank response and verified opportunities use the selected cutoff consistently.

The ingestion cache is versioned `0.5.0` because action windows, generic cutoffs and tank response facts are new. Existing shared results remain immutable snapshots. The UI identifies an older result and offers an explicit **Update analysis** action which creates a new unique link; it never silently rewrites an old shared score.

## Validation boundaries

Unit/property cases exercise all ten S2 boss IDs, all four raid difficulties, six tank classes, mixed roles/difficulties, sparse data, unranked kill-percentile placeholders, cast spam, unknown auras, missing actors, Feign Death, resurrection and fixed-weight algebra. Live acceptance uses `6fjJxRFC21YHdTXB` (22 pulls, Heroic/Mythic) and `LfhZ47qyPY8FRQH6` (13 Heroic pulls across all ten bosses), including per-boss, per-pull, wipes/kills and cutoff selections. Independent checks compare raw metric-table totals, death/life timelines, response denominators and score decomposition. The methodology remains heuristic and auditable; it is not a guarantee of universal mechanic detection or calibrated player-skill accuracy.
