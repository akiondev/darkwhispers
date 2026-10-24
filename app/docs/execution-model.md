# Composite score · 0.11.0

Model: composite/v1. A report-relative review, not a Warcraft Logs parse or universal skill rating.

## Fixed weights

| Component | DPS | Healer | Tank |
|---|---:|---:|---:|
| Reviewed mechanics | 45 | 45 | 55 |
| Report-relative output | 30 | 20 | 10 |
| Recorded survival | 20 | 30 | 30 |
| Verified preparation | 5 | 5 | 5 |

Each component is 0–100. Total = sum(weight × component / 100). DPS components 90,80,95,100 produce 88.5. Weights are product policy, not proven causal coefficients. Per-pull roles determine separate rows and scores; total damage taken never penalizes tanks.

## Mechanics

Only reviewed applicable rules with supported denominators enter the score. Completed enemy casts/contact windows identify passes, failures and unresolved checks while dead. Multiple ticks cannot become repeated failures for one opportunity. Families use fixed rule weights rather than tick frequency. Assigned interrupts, soaks, dispels and swaps require proof of individual obligation.

Family lower bounds credit verified passes; upper bounds also permit unresolved checks. Dead players are not asserted to have passed or failed. Missing supported opportunities leave mechanics unresolved rather than granting 100. Boss-specific meanings require maintained versioned rules.

## Output

For DPS and tanks, use DamageDone total; healers use effective Healing total, including effective absorbs and excluding overhealing as reported by WCL. Within the same pull and role: output = 100 × player total / highest eligible role-peer total. Require at least two contributing role peers and a positive reference; otherwise unresolved. Whole-pull time is common, so this equals the ratio of full-pull DPS/HPS.

Kills and wipes use this same report-relative basis. Native kill percentiles cannot provide a validated wipe benchmark. Class, gear, assignments, healing demand, raid composition and target padding affect this comparison. It is not spec-normalized skill. Healer/tank output receives less weight. No extra external reference requests are made.

Output already reflects contribution lost while dead. Survival separately values availability by explicit policy; no additional survival multiplier or flat death/resurrection charge applies.

## Life integrity

Survival = 100 × recorded alive time / full attended encounter time. Never trim terminal death clusters or infer a Discord wipe call. Deaths, first-death ties, accepted resurrections and intervals remain separate facts. Res ends an interval without erasing the death. An endpoint death counts with zero following dead time.

Feign Death is excluded. Verified successful Reincarnation (21169 and matching report name) supplies self-return time; native res takes precedence. Positive source health can expose missing res evidence but cannot fabricate an exact return timestamp. Incomplete life evidence makes survival unresolved. Invalid pages/tables fail import. Existing independently audited 0.10 life facts must remain identical.

## Preparation and contextual facts

The 5 preparation points divide equally between verified flask and food at pull start. Exact ID/name matches establish presence. Unclassified or missing snapshots do not establish absence. A verified category receives credit; unresolved categories retain 0–100 bounds. No absence is inferred from a small catalogue or empty aura snapshot.

Healthstones, potions, enchants, gems, defensives, interrupts, dispels and intake remain facts with no arbitrary spam reward or unproved missed-opportunity penalty. Adding score effects requires validated opportunity rules.

## Missing data, aggregation and presentation

Never redistribute missing weights. Sum weighted component lower/upper bounds; exact totals exist only when these coincide. Otherwise display a preliminary interval, not a midpoint or survival-only substitute. Missing evidence cannot create points. No contribution must not become a perfect score.

Combine components using original full attended duration; unresolved pulls remain included. Separate role lists. Partial attendance is labelled rather than given a full-selection ordinal. Preliminary intervals do not assert precise ranks. Equal displayed complete scores tie.

Details show weighted arithmetic, actual mechanic failures/deaths with WCL time links and verified character profile links. Unknown bosses can retain output, survival and preparation evidence without invented mechanics.

## Performance and verification

Reuse full-pull tables and event reductions; no per-player network calls. Preserve bounded pagination, two concurrent pulls, three upstream requests, versioned report/pull caches and independent retry reuse. Preparation changes bump ingestion cache version. Old snapshots retain their model.

Verify both real reports against 0.10 life facts, role switches, all tank classes, output influence, mechanic failures, incomplete evidence, no peers and deterministic aggregation. Raw evidence stays private on the VPS. Publish only the GitHub-built attested artifact.

## References

- [WCL table types](https://www.warcraftlogs.com/v2-api-docs/warcraft/tabledatatype.doc.html).
- [WCL rankings](https://www.warcraftlogs.com/help/ranks/): kill parses, specs, brackets and partitions.
- [Wipefest methodology](https://www.archon.gg/wow/articles/news/wipefest-vault-of-the-incarnates): boss rules and assignment limitations.
- [WCL DeathEvent](https://www.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.DeathEvent.html).
- [WoWAnalyzer AnkhNormalizer](https://github.com/WoWAnalyzer/WoWAnalyzer/blob/midnight/src/analysis/retail/shaman/shared/core/AnkhNormalizer.jsx).
