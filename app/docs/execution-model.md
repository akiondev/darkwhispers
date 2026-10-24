# Execution score · 0.8.0

This is an execution-and-availability score, not proof of overall class skill, raid contribution, AFK status or fault for a wipe. DPS/HPS, intake, preparation and observed item usage remain visible outside the score. DPS, healers and tanks have separate standings.

## Per-pull formula

- M: mean success percentage across the reviewed mechanic families that had applicable, completed check windows. Each family has equal budget, regardless of cast frequency or legacy severity weights.
- A: recorded time alive / the shared assessed duration, expressed as a percentage.
- D: deduplicated real deaths before the assessment stop.

```text
base = M * A / 100
score = max(0, base - 5 * D)
```

The five-point death cost is a declared policy, not a value supplied by Warcraft Logs. It is deliberately additional to lost availability and uncredited checks. It persists after battle resurrection or self-resurrection. Accepting a resurrection has no separate penalty; the caster receives none. The multiplicative base is naturally bounded by both M and A and has no former 70/30 plateau.

With M=100: full survival and no deaths gives100; A=98 with one death gives93; A=80 with one death gives75. Clamping at zero prevents negative scores. Zero mechanic success cannot earn survival-only points.

## Opportunities and data integrity

The fixed SCORING_FAMILIES catalogue in shared/encounters.ts declares reviewed cast/contact families. Other tracked mechanics remain observations until a reviewed model change. Required tank contacts, assignment-dependent soaks/interrupts/dispels and unverified floor exposure are not generic errors.

A completed applicable check remains in the player's denominator while dead. A missing hit earns a pass only when the player is alive throughout the declared check window. A recorded direct contact is one failed check, collapsing ticks/components. No contact while dead or partially absent is marked 'not credited while dead', not a proven mechanic failure. The planned applicability and observed cast schedule do not disappear with death.

Unfinished windows at the assessment end contribute neither passes nor failures for anyone. The same caster/instance and verified parent cast are required. A creature attempt without completion cannot manufacture success.

If a required active family has incomplete linkage for a role peer, the whole role/pull grade is unavailable. Removing an uncertain family must not promote everyone to100. No observed applicable checks gives no grade, never neutral points or free perfection. Positive contribution is required; one action is not proof of meaningful participation, and this model does not claim reliable AFK detection.

## Wipe boundaries

Kills use encounter end. Wipes require either a recorded WCL wipecalled event or an explicit manual stop, shared by all actors. Manual offsets are integer milliseconds from pull start, positive and no later than encounter end; kill overrides and unknown fight IDs are rejected. Earliest valid logged call wins unless explicitly overridden manually. Calls outside a wipe are ignored.

Without a confirmed stop, a wipe retains factual statistics but no mechanic or execution grade. Discord voice calls and an arbitrary count of deaths are never guessed. All events at or after the stop are excluded, including deaths, resurrection, casts and item uses. Table queries use the same start/end bounds. Pending mechanic windows are censored for everyone. Manual provenance is visible and frozen in the immutable analysis selection.

API wipe-call errors are not interpreted as absent calls. Pagination is validated even across empty pages. Versioned pull cache keys contain report revision, fight boundaries, ingestion version, assessment source and assessment end, so manual reanalysis cannot reuse incompatible full-pull facts.

## Aggregation and comparison

Pull scores are weighted by assessed duration within each boss/difficulty. Difficulty contexts and attended bosses then receive equal weight. Aggregate fields are summaries, not inputs to a fresh global formula. Unscored pulls supply no replacement points. Scored/attended counts stay visible; raw statistics also include unscored pulls.

Ordinal ranks require participation and a complete grade in the same role's scoreable selected pulls. Partial attendance/evidence retains a visible partial score but no misleading ordinal rank against a different selection. A character who changes role has separate stable actor-and-role rows. There is no cross-role rank or implied comparison with the worldwide player population.

## Recorded life events and verification

Death/resurrection observations are deduplicated and Feign Death is excluded. A real death that includes an earlier death-save field is still a death. Source and ability metadata are retained where supplied; only recognized ID/name pairs are labelled combat resurrection. Missing ability metadata is unclassified, not proof of a shared charge being spent. Life interval semantics must remain consistent with the actual v2 response; a spell cast alone is never treated as a return to life.

References: [WCL death events](https://www.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.DeathEvent.html), [resurrection events](https://de.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.ResurrectEvent.html), [wipe-call events](https://es.classic.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.WipeCalledEvent.html), [Wipefest's recorded-call workflow](https://www.archon.gg/classic-fresh/articles/news/wipefest-naxxramas).

Focused tests cover the published formula, all six tank profiles, late-death censoring, persistent death costs after battle resurrection, same-time/post-stop deaths, pending windows, ambiguity, fixed family budgets, duration weighting, attendance, manual API validation and wipe pagination. Acceptance reports remain6fjJxRFC21YHdTXB andLfhZ47qyPY8FRQH6. Synthetic fixtures are labelled and cannot substitute for real verification. Previous links remain unchanged snapshots and require explicit reanalysis to adopt this model.
