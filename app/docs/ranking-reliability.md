# Ranking reliability audit · engine 0.2.1

Acceptance report: `6fjJxRFC21YHdTXB`, 22 completed pulls, four bosses, 26 participating report actors. The Sszorak Mythic selection contains 18 wipes and 20 players. Verification used authenticated API v2 queries, not screenshots or the synthetic demo. Credentials and raw player event files remain private.

## Measurements and corrections

Separately requested report-wide damage, healing and damage-taken tables matched the sum of the per-pull measurements for every participant. A new 138,720-event timeline (19 pages) provided an independent check of life, utility, tank context and mechanic processing. The offline ingestion and scoring-window replay passed 3,326 independent comparisons with no mismatches. A separate deployed-data check passed 5,905 comparisons, including life/Tempest values, utility, healing cooldowns, taunts, Ravage, aggregate output, available overhealing and the actual Sszorak score formula. Healing/absorbs use the Warcraft Logs healing table total; overheal is recorded separately and is not added to HPS.

A separately requested `type = "miss"` timeline identified 12 Tempest misses/immunities that the API serialized as `type: "damage"`. They are excluded by the production query's WCL damage predicate. The broad offline export must apply that classification too; a serialized type or zero amount alone is not sufficient. Of 572 non-periodic records, 560 were real direct contacts, including 20 fully absorbed contacts. Ravage also explicitly uses WCL's damage predicate. No numeric hit-type enumeration is guessed, and full absorbs are not discarded as misses.

The raw timeline contained 11 Feign Death events. Nine belonged to participating actors and had incorrectly entered the old app's death/life measurements. Eight affected Sszorak. Explicit `feign: true` events are now excluded. The corrected result has **381 real deaths across the whole report**, including **369 on Sszorak**, rather than the previous 377 Sszorak death count. Battle resurrections still restore life intervals. An unlabelled environmental death remains a real death.

The new ingestion version invalidates old cached facts. This is required for correctness; a UI refresh alone must not reuse the faulty death/life cache.

## Tanks and healers

Total damage taken is never a scoring penalty or bonus. Tanks are expected to take boss hits. Sszorak's Ravage contacts and hits while a prior Ravage vulnerability was active are displayed for review. They do not become an automatic tank-swap failure: an immunity, assignment or another player's action may change the interpretation. Taunts, defensive casts and logged healing are context, not an availability/timing grade. The two tanks' lower common-factor scores in this report primarily reflect Tempest contacts; they do not establish that the tanks performed worse at tanking than every damage dealer.

Healers retain HPS, overhealing, successful dispels and catalogued healing/raid cooldown casts as observations. None awards points merely for a larger count. Healing demand, assigned targets, other healers, absorbs, class/spec and fight length affect them. Kill output percentiles, when available, compare HPS within class/spec; this report's selected Sszorak wipes have no kill percentile. Output and assigned utility remain unscored when comparable evidence is absent.

The combined 0–100 order remains a provisional comparison of the measured common factors. A separate within-role rank is available for tanks, healers and damage dealers. Mixed/unknown roles do not receive a made-up within-role rank. The engine never labels partial boss/role coverage as strong confidence just because many pulls were logged. Partial per-boss scores also never receive the gold perfect-score badge.

## Wipe comparison window

The UI defaults to comparing before raid collapse. On **audited Sszorak Mythic wipes only**, the scoring window ends at the earlier of a logged Unbound Ferocity application or the point after which at least half the roster remains simultaneously dead for the rest of the pull. Same-timestamp deaths/resurrections are grouped and Feign Death is ignored. Kills, other bosses and other difficulties retain their full durations.

This is a versioned comparison convention, **not a detected raid-leader wipe call or proof that the fight was unrecoverable**. The control can be switched off. Full-pull damage, healing, damage taken and real death totals remain visible either way; the shorter window affects survival and Tempest scoring only. Evidence outside the selected scoring window stays accessible and is marked unscored. Ravage review context always ends at the recorded comparison cutoff when present, otherwise at encounter end; that observation window is independent of the survival/Tempest scoring toggle.

## Reliability is not just repeatability

Repeated execution of the same inputs must return the same scores. Equal boss weighting, missing-category exclusion, attendance gates and the exact applied categories remain auditable. Missing measurements are never assumed perfect or zero.

As a sensitivity check on the 18 Sszorak wipes, every one-pull omission was recalculated. The largest player's score range across those 18 subsets was **6.63 points**. This measures sample sensitivity, not a confidence interval, predictive accuracy or a validated measure of complete raid skill. Close positions should not be treated as decisive.

Validated live mechanic scoring remains limited to direct Tempest contact. Required soaks, crosswind assignments, cyst placement, healing priority and active-mitigation timing are not fully scored. A 70% category-weight coverage figure is **not 70% of all boss mechanics or role skill**. No statement that the engine can conclusively identify the best or worst raider is supported by this audit.

Sources: [Warcraft Logs event semantics](https://www.warcraftlogs.com/help/pins), [rankings and historical class/spec comparisons](https://www.warcraftlogs.com/help/ranks/), [Tempest rule and spell sources](sszorak-tempest.md), [firsthand Sszorak encounter strategy](https://www.method.gg/guides/the-venomous-abyss/sszorak-heroic).
