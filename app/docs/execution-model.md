# Automatic execution score · 0.9.0

Every valid completed selected boss pull contributes automatically. Wipes do not require manual stop times. New requests ignore legacy manual overrides. Invalid/incomplete upstream imports still fail explicitly instead of producing invented facts.

## Automatic assessment window

1. Kills retain encounter end.
2. The earliest valid recorded WCL wipecalled timestamp is used when present.
3. Otherwise a common automatic policy uses the roster's recorded deaths/resurrections. On raids with at least ten participants, terminal mortality must reach at least50% and remain at or above that level through the final five seconds or more. The boundary is the first death of the close-spaced final death burst leading into that state; successive final deaths are joined only when gaps are no more than five seconds. Isolated earlier deaths are retained. Recovery below the threshold invalidates that candidate. Feign Death and duplicate deaths cannot inflate mortality.
4. If no qualifying terminal collapse exists, use encounter end. Never block scoring or ask the user to label a wipe.

The automatic boundary is an estimate under a declared comparison policy, not evidence of the raid leader's actual voice call. It is shared by all actors. Raw life observations come from one bounded event stream; tables are fetched only for the selected interval. No second upstream event download is needed. Private boundary-life facts make cache validation reproducible and are omitted from public analysis payloads. Cache identity includes report revision, fight boundaries, ingestion version and the automatic policy.

## Per-pull score and death policy

When complete shared mechanic measurements exist:

```text
base = mechanics * recorded_time_alive /100
```

Each reviewed applicable mechanic family has equal budget; recurring trivial casts cannot dominate a different family solely through frequency. Applicable check windows remain in the denominator while dead. No contact earns a pass only when present throughout the window; death-related missing completion is labelled uncredited rather than a proven mechanic error. Direct contacts collapse ticks/components into one check. Required tank contact and uncertain assignments are observations, not generic mistakes.

When these mechanics cannot be measured uniformly across the role/pull, use:

```text
base = recorded_time_alive
basis = survival-only
mechanics = null
```

This is a labelled availability measurement, not fabricated perfect mechanics. The entire role/pull switches basis consistently. There are no Unknown weights or neutral midpoint points. A survival-only score is not directly equivalent evidence to a mechanically measured score; that distinction is displayed. No recorded output, healing, casts or utility earns zero execution credit, not an accusation of AFK behaviour.

Kills and recorded-call windows use max(0,base -5 * recorded_deaths). The death deduction remains after battle resurrection. Unmarked, automatically bounded wipes use max(0,base) with NO additional fixed death charge: intent during wipe cleanup is not reliably observable. Early absence still affects actual availability and applicable mechanics. Accepting a resurrection adds no charge. The five-point known-window policy is a design choice, not proof of fault.

## Ranking and comparison

All valid attended pulls have numerical scores, including short or mechanics-unmeasurable pulls. Pull scores are weighted by assessed duration inside a boss/difficulty, then difficulty contexts and bosses have equal weight. Separate DPS, healer and tank standings are retained. Partial attendance is labelled and does not claim a comparable full-selection ordinal rank. Raw output and intake remain visible but unweighted. No claim is made to infer universal class skill, true AFK behaviour or sole responsibility for a wipe.

## Compatibility, repairs and verification

Older snapshots retain their original results. An explicitly repaired link can carry a replacementId referring to a newly computed same-report job. API reads follow bounded, cycle-checked replacement pointers without enqueueing work; the original stored result is preserved. New analysis links use execution/v3. No automatic background reanalysis of arbitrary shares is introduced.

Tests cover automatic terminal bursts, temporary recovery, isolated earlier deaths, shared boundaries, one-stream import, private-cache stripping, full-pull fallback, numerical scores without wipe markers, labelled survival-only measurements, zero contribution, fixed family budgets, all six tank classes, known-window combat-res death costs, ignored legacy manual controls, immutable snapshots and safe repair links.

Acceptance includes the real reports6fjJxRFC21YHdTXB andLfhZ47qyPY8FRQH6, and the exact18-wipe selection from analysis279e579e-b0e9-4a08-99c4-46d201772086. Raw reports remain on the VPS; local UI fixtures are labelled synthetic. A passing formula test is not proof of perfect fairness or exact detection of an unlogged voice call.
