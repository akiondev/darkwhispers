# Survival score Â· 0.10.0

Model ID: `survival/v1`. All completed selected boss pulls use the full recorded encounter, including wipes. No manual input or inferred wipe cutoff is required. The score measures recorded survival, not total player skill or responsibility for a wipe.

## Formula

For each character and actual role used during the selected pulls:

```text
encounter time = sum of full attended pull durations
dead time = sum of verified death-to-resurrection/end intervals
alive time = encounter time - dead time
score = 100 * alive time / encounter time
```

The same formula applies to DPS, healer and tank. Their ranking lists remain separate. A character playing DPS in some pulls and healer in others has two rows and two scores. No role receives an output, intake or class-specific adjustment.

Score inputs are not rounded before aggregation. Every measured second has equal weight, including across bosses and difficulties. A ten-second pull does not carry the same weight as a five-minute pull. Splitting a measured interval does not change the result. Adding dead time with duration held fixed cannot improve the score.

Death count is displayed separately; there is no arbitrary flat death charge. An accepted resurrection ends the dead interval without deleting the death or previously accumulated dead time. Multiple deaths create multiple intervals. A death exactly at encounter end remains a death but adds no time after the encounter. This distinction is visible in the player detail.

## Full encounters and trustworthy life facts

No terminal death cluster is removed. A recorded wipe call is contextual information, not permission to shorten the measurement. This fixes the old policy that could erase the first death of a terminal burst and then display zero deaths and zero dead time. Legacy manual stops and inferred evaluation windows cannot affect new scores; shortened cached measurements are rejected.

Real death and accepted resurrection events supply the timeline. Feign Death is excluded. An attempted resurrection cast on another player is not treated as an accepted resurrection. A verified successful Reincarnation self-cast (21169, matching the report ability name) supplies its actual self-return timestamp, as in WoWAnalyzer’s maintained parser; an existing native resurrection takes precedence. A later cast with positive source health can expose a missing resurrection but never invents its exact timestamp. Prior death-save metadata does not erase a real death. Pagination must complete; duplicate page-boundary events cannot be counted twice. Ambiguous transitions, missing initial state or contradictory life evidence are marked incomplete rather than manufactured into perfect survival.

A player with incomplete required life evidence has no combined score. Valid individual pull details remain available. Unobserved exposure is never silently removed to increase the aggregate. No recorded combat contribution produces an unscored row with an explanation, not an AFK accusation or an invented zero-performance verdict.

## Facts outside the score

DPS/HPS, damage taken, interrupts, dispels, observed preparation/items and reviewed mechanic observations remain contextual facts. They do not alter the survival formula. Required damage, assigned utility and class-specific opportunities are not universally comparable. The standard API alone cannot identify every future boss mechanic as correct or failed play.

Recorded deaths and other supported events link to their Warcraft Logs pull and time range. A killing blow is the last logged cause of death, not proof of who caused the wipe. Profile links use actual character/realm/region identity when available; missing identity must not produce a guessed profile.

## Ranking and limits

Within each role, comparable complete attendance receives an ordinal rank. Partial attendance keeps its numeric score, attendance count and explanation, without a misleading full-selection rank. Identical displayed scores share rank. There is no neutral Unknown-weight category.

The formula applies to any completed boss encounter with supported, complete standard API facts; boss IDs and spell rules are not score inputs. Unknown bosses do not require a mechanic catalogue entry. A 100 means full recorded survival, not perfect performance. Intentional wipe deaths, sacrificial assignments, different encounter risk and players surviving without useful play require human interpretation. No formula can recover an unlogged voice call or guarantee fault attribution.

## Integrity and performance

Ingestion uses full encounter boundaries and versioned cache identity. Report revision, fight boundaries, ingestion version and the full-encounter policy prevent reuse of truncated older facts. Required events are paginated and reduced into per-actor intervals. Cache-only boundary data is not exposed in public results. Raw audit reports remain private on the VPS.

Saved historical snapshots retain their model. Explicit same-report replacement links may point to a newly calculated result while preserving the original stored snapshot. Reading a result never creates a background analysis job.

Tests cover formula examples, seeded monotonicity, duration weighting and split invariance, role changes, all six tank classes, unknown encounters, death/resurrection endpoints, first-death preservation during terminal wipes, incomplete-life rejection, obsolete cache rejection, pagination, privacy and repair-link behaviour. Real-report verification remains a release requirement; synthetic tests are labelled and do not substitute for it.

## Primary references

- [WCL Report API](https://www.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html): event/table queries, pagination, optional wipe cutoff and non-frozen data schemas.
- [DeathEvent](https://www.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.DeathEvent.html): real death, feign flag and earlier death-save metadata. Raw v2 fields require their own validated mapping.
- [ResurrectEvent](https://de.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.ResurrectEvent.html): resurrection target and report-relative timestamp.
- [WCL death statistics](https://www.warcraftlogs.com/help/deaths): aggregate statistics apply wipe and reincarnation policies; they must not be confused with unfiltered raw event counts.

The API documents evolving event/table shapes. Validation, source links and regression tests provide reviewable measurements; they do not establish a guarantee of flawless future data or universal player-performance judgement.

- [WoWAnalyzer AnkhNormalizer](https://github.com/WoWAnalyzer/WoWAnalyzer/blob/midnight/src/analysis/retail/shaman/shared/core/AnkhNormalizer.jsx): normalizes the successful Reincarnation self-cast.
- [WoWAnalyzer raw event types](https://github.com/WoWAnalyzer/WoWAnalyzer/blob/midnight/src/parser/core/Events.ts): resourceActor 1 denotes source, 2 target. Positive health observations validate consistency, not an inferred recovery date.
