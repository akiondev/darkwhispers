# Measured raid score · 0.12.0

Model: composite/v2. One 0–100 score summarises recorded contribution and verified mechanic completion, rather than an inferred interval of complete player skill.

## Three components

| Component | DPS | Healer | Tank |
|---|---:|---:|---:|
| Verified mechanic completion | 50 | 50 | 60 |
| Recorded output | 30 | 20 | 10 |
| Full encounter survival | 20 | 30 | 30 |

Total = sum(component × fractional weight). DPS components 80, 80, 90 produce 82. Weights are explicit product policy. Actual per-pull roles produce separate rows and scores. Tank intake and class mitigation totals cause no generic penalties.

## Verified completion

Mechanic completion = 100 × verified successes / valid applicable encounter opportunities. Checks while dead earn no completion credit but are NEVER labelled failures. Example: 16 successes, 2 failures, 2 checks while dead give 80. No hypothetical outcome is estimated. Families retain fixed weights rather than tick-frequency weighting.

Only reviewed rules with known applicability and valid denominators qualify. Soaks, interrupts, dispels and tank swaps need proof of individual obligation. Death influences availability, delivered output and actual completion by deliberate policy; no extra flat death/resurrection charge or survival multiplier is applied.

## Shared measurement scope

Resolve eligibility for the entire same-role group in the SAME PULL: identical boss, difficulty, time. Exclude an uncertain rule for everyone in that group, not selectively for a player. One uncertain pull does not invalidate other pulls.

Without any supported checks, the whole group uses output/survival: DPS 60/40, healer 40/60, tank 25/75. Mechanics gets zero weight, not an invented 100 or 0. Details explain the measured scope. Unknown bosses retain a numeric two-component score. Missing food classifications never block scoring.

## Output and life facts

Output = 100 × player total / highest same-role total in that pull. DPS/tanks use DamageDone; healers use effective Healing including effective absorbs as reported by WCL, excluding overhealing. Same basis for kills and wipes. A sole positive-output participant has ratio 100 with explicit no-peer context, not a comparative rank. Zero role output means zero output credit. No recorded activity does not establish participation.

This is report-relative contribution, not spec/gear normalization. Class, gear, assignments, healing demand, raid composition and target padding affect it. No kill parse is applied to a wipe or fetched per player.

Survival = 100 × recorded alive time / full encounter time. Preserve all kills/wipes, death counts, first-death ties, accepted resurrections and exact intervals. Never infer voice wipe calls or trim terminal clusters. Resurrection ends an interval without deleting the death; endpoint deaths count with zero subsequent dead time.

Feign Death is excluded. Verified successful Reincarnation supplies self-return time; native resurrection takes precedence. Positive source health can expose a missing resurrection but cannot fabricate its timestamp. Genuine inconsistent life data, corrupt essential input or absent participation remains explicitly unavailable, not an invented score or zero dead time. Limited mechanic coverage instead uses the common fallback.

## Aggregation and UI

Calculate each pull using its common scope, then average by full attended duration within each role. Aggregate component points and effective weights identically; their sum equals total. Mixed scope is explained. Essential invalid data is never silently omitted to raise a total.

Normal rows show one number, no intervals or Preliminary label. Separate DPS/healer/tank lists. Role changes yield separate scores. Partial attendance retains score and pull count, without claiming equal full-selection exposure. Equal displayed scores tie; only an actual 100 gets the perfect-score badge.

Details show three contributions, successful/failed/not-completed counts, accurate death data and WCL evidence links. Profile links use verified identity. Flask, food, potions, healthstones, enchants, gems, defensives and utility remain facts outside scoring.

## Performance and verification

Reuse full-pull tables/events and the 0.11 ingestion cache. This scoring/UI change does not require redownloading facts. Preserve bounded pagination, concurrency, revision caches and independent retries. Historical snapshots retain model identity.

Verify both real reports against independently checked full life facts. Test the 82 example, dead checks, cohort exclusion, unsupported bosses, missing buffs, all tank classes, role changes, zero output, sole-role participants and mixed-scope aggregation. Publish only GitHub-built attested artifacts. Credentials/raw audit logs stay on the VPS.

## References

- [WCL table types](https://www.warcraftlogs.com/v2-api-docs/warcraft/tabledatatype.doc.html).
- [WCL rankings](https://www.warcraftlogs.com/help/ranks/).
- [Wipefest methodology](https://www.archon.gg/wow/articles/news/wipefest-vault-of-the-incarnates).
- [WCL DeathEvent](https://www.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.DeathEvent.html).
- [WoWAnalyzer AnkhNormalizer](https://github.com/WoWAnalyzer/WoWAnalyzer/blob/midnight/src/analysis/retail/shaman/shared/core/AnkhNormalizer.jsx).
