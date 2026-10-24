# Execution score · 0.7.0

The score measures recorded mechanic execution and time alive. It is **not** a complete assessment of player skill, class balance, damage contribution, raid assignments or responsibility for a wipe. DPS, HPS, intake, preparation and observed item usage are visible facts alongside the score.

## Two inputs, one declared formula

For each eligible player/pull, let:

- `M = 100 × passed verified mechanic opportunities / verified opportunities`.
- `A = 100 × recorded time alive / actual pull duration`.

Then:

```text
base = 0.70 × M + 0.30 × A
score = min(base, A)
```

Mechanics has 70% of the base weight. Time alive caps the result so an early death cannot avoid later checks and earn a high score. The cap is explicit: when it binds, improving mechanics alone does not increase the final score. The weights and cap are transparent design policies, not facts supplied by Warcraft Logs.

Examples with clean observed mechanics in a 300-second pull:

| Recorded presence | Score |
| --- | ---: |
| Alive throughout | 100 |
| Dies after 60 seconds and stays dead | 20 |
| Dies at 290 seconds | 96.7 |
| Dead for 30 seconds, then resurrected | 90 |

With `M = 60` and `A = 80`, base and final score are 66. A recorded death does not also receive a flat deduction. Multiple dead intervals are merged and battle resurrections credit only time actually alive. Feign Death must not become lost presence.

## What qualifies as a mechanic check

Only controls with a verified opportunity denominator are scored. Cast-linked checks collapse damage ticks/projectile components into their defined incident. A missing hit is a pass only when the player had an observed, applicable opportunity. No observed opportunities does not mean perfect mechanics.

The same declared rule set applies to the comparable role cohort on a pull. Incomplete exposure or aura state cannot manufacture clean checks for one player while another receives a penalty. Required tank contacts, autoattacks, assigned soaks, unassigned utility, failure-only ground exposure without a reliable denominator, and context-only observations do not become generic personal mistakes.

Unsupported or incomplete checks are omitted, not assigned 50 points. A pull without comparable mechanics has no combined execution score; it remains visible with raw facts and a short reason. Missing actor metrics or incomplete imports stop the analysis rather than becoming zero output, perfect survival or replacement points.

## Roles and aggregation

Standings are separate, ordered **DPS → Healers → Tanks**. A character who changes role has a separate result for each actual role, with a stable actor-and-role identity. There is no global cross-role ordinal rank.

Calculate each eligible pull first. Average scored pulls within a boss/difficulty/role context, average difficulty contexts within a boss, and give attended bosses equal weight in the whole-report view. At **every level**, cap that score by average observed availability from **all attended child contexts**, including those with no mechanic score. Thus dying before the first check on many pulls cannot disappear from the denominator and leave one clean 100 as the whole result. If every child is unscored, the aggregate remains unscored; observed availability does not invent mechanic success.

Unattended bosses add neither zero nor 50. Show attended and actually scored pull counts; different attendance is not equally strong evidence. The overview is an aggregation of pull/context results, not a fresh calculation from one global success ratio. Its displayed availability ceiling follows the same equal-pull/difficulty/boss aggregation; raw alive milliseconds remain a separate factual total.

Use the full recorded encounter duration consistently. Inferred raid-collapse or spell-specific enrage cutoffs do not silently change survival or the mechanic denominator. A raw `excludeWipeTail` flag on an older saved selection must not reactivate the retired inference in the new score.

## Facts outside the score

Raw DPS/HPS and damage taken are visible as context. More damage or healing is not automatically better class/spec play, and tank intake is not an avoidance failure. Historical kill percentiles, activity-window estimates, class-specific defensive-response estimates and missing-evidence midpoint weights are excluded from the new score.

Preparation/item facts are conservative observations: active buffs at pull when a valid snapshot exists, observed potion/healthstone use and available gear information. A missing snapshot is not proof of a missing flask. A potion active at pull is not automatically proof of a precisely timed pre-pot. No use of a healing item does not prove it was owned, available or needed. Enchant completeness requires validated slot, item and class rules; there is no invented universal "fully enchanted" grade.

The WCL [combatant-info definition](https://www.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.CombatantInfoEvent.html) documents gear and active starting auras. Its typed scripting properties must still be mapped to the actual v2 JSON. WCL [confirms rankings are only available for kills](https://forums.combatlogforums.com/t/no-rankings-on-mythic-one-armed-bandit-through-v2-api-why/16239), so the core score does not depend on them.

## Limits and verification

A player with exactly zero recorded output, casts, interrupts and dispels has no execution rank, rather than receiving 100 for passive survival. This is a factual participation guard, not a rotation or activity-window score. A player can still contribute very little after one cast. The two-input score therefore must not be advertised as an AFK-proof overall "best raider" grade. Output is deliberately prominent; the reader still interprets assignments and encounter context.

Regression checks cover the exact death examples, early-death gaming, resurrection/Feign Death, zero opportunities, unknown rule state, mandatory tank intake, duplicated events/ticks, missing imports, raw-output independence, role changes, partial attendance, aggregation and bounded scores. Labelled synthetic fixtures exercise all ten S2 encounters and four raid difficulties; they are not a substitute for live coverage on every class/boss combination.

Real acceptance reports are `6fjJxRFC21YHdTXB` and `LfhZ47qyPY8FRQH6`. Completed older links remain immutable snapshots. Reanalysis explicitly creates a new result using the new model; model versions are never mixed in one standings calculation.
