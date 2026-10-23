# Midnight S2 encounter review, version 0.6.0

The registry in `shared/encounters.ts` covers all ten encounters listed by Warcraft Logs for this season: Nek'zali, Entombed Sentinels, Vashnik, Lost Explorers, Sszorak, Twin Fangs, Coiled Altar, Ula'tek, Nymrissa and Kith'ix. WCL world metadata was checked directly: zone 53 exposes difficulty IDs **1 (LFR), 3 (Normal), 4 (Heroic), 5 (Mythic)**. Do not confuse Blizzard journal IDs, WCL encounter IDs and spell IDs. Unknown encounters still get generic role measurements, with no invented boss mechanic grade.

## What a rule means

Each encounter has a difficulty-gated inventory, including avoidance, required soaks, tank duties, targeted resolutions, utility and shared raid pressure. The inventory is a review model, **not a claim that all mechanics can be scored as individual skill**. Every player/pull shows each applicable family, its actual spell IDs, received damage, hits, aura applications, successful utility, outcomes, evidence links and reference. Unknown/new damage spells remain visible as unclassified observations.

Verified contact checks use observed casts and live spell names. Misses/immunities and periodic ticks do not become direct hits; full absorbs remain contacts. Ground effects use ten-second episodes, with clean exposure explicitly unknown. Tank strikes use the prior vulnerability lifecycle, collapse the components of one channel, and separate required tank contact from non-tank frontal contact. An unknown initial aura state is not a clean success. Swap observations identify an outcome for review, not sole-player responsibility.

Required Mutilate, Ravenous Feast and Guillotine contacts are not generic avoidance errors. Repeated contact with the relevant prior vulnerability is a separate check. Non-soakers do not fail an assignment the app does not know. Helical Toxins and other targeted resolutions require their actual terminal evidence. Gravebound fragment pickup damage is **correct play**, not a failure; only a logged lethal Gravebound expiry fails its resolution check. Death, cutoff and missing terminal events censor the outcome.

Interrupt/dispel records are matched using the affected spell ID, not the player's interrupt spell ID. Successful utility is visible without inventing missed assignments for other players. Shared add failures, unsoaked raid incidents, unavoidable pulses, intentional crate/egg damage and healing checks remain contextual.

## Score and role separation

The fixed 0–100 role model remains inspectable. Each mechanic family has its own severity budget; many easy waves cannot dilute a different important rule. Within a family, known opportunities determine the success fraction. Known fraction and a three-opportunity sample cap determine measured weight. Unknown weight remains an explicit neutral midpoint with lower/upper missing-evidence bounds. These are published design policies, not calibrated probabilities of skill or causal wipe attribution.

DPS, healers and tanks have separate standings, in that order. Mixed/unknown roles are disclosed separately; each pull uses its actual specialization. All selected bosses have equal weight and each difficulty context is separate. Missing attendance is unknown, not zero. All six tank specialization profiles retain their measured personal defensive response under actual pressure. Raw damage taken, healing received, self-heal magnitude and overheal do not independently award or deduct skill points.

Per-pull scores use the same factors but are not averaged directly into the overall result: boss/difficulty aggregation and sample coverage matter. Raw damage/healing totals remain full-pull facts; scored survival and mechanic outcomes honor the selected cutoff.

## Evidence limits

Positions exist in advanced WCL events, but a coordinate alone does not establish an assignment, a safe intended route, who moved into whom, or an optimal defensive plan. This release does not invent positional verdicts. Boss-specific stack thresholds that are strategy recommendations rather than encounter-defined failures remain observations. Flexible raid sizes do not inherit a Mythic-only fixed soak requirement. A context-only rule is neither a personal failure nor a perfect success. New spell variants are not silently accepted as verified errors.

LFR/Normal/Mythic rule gating and all six tank classes have synthetic regression coverage. The supplied real reports verify Heroic on all ten bosses and Mythic Sszorak; **they do not constitute live validation of every difficulty or every class/boss combination**. Fixtures are labelled synthetic. These limitations must remain visible in the app and release notes.

## Sources and ID verification

Original rule logic was written for this app. Guides establish encounter intent; actual WCL timelines and extracted game spell records establish event variants. Numeric IDs/names are factual references, not copied addon implementation.

- [Method raid guides](https://www.method.gg/guides/the-venomous-abyss), including the linked Heroic and Mythic guide for every main-raid boss.
- [Method: Kith'ix](https://www.method.gg/guides/the-unbinding-of-kithix/kithix).
- [Method: Nymrissa](https://www.method.gg/guides/the-tidebound-grotto/nymrissa-wavecaller). The Mythic Water Jet / lower-difficulty Iceblade Flurry distinction was cross-checked with the reference addon and actual Heroic timeline.
- [BigWigs source reference, pinned snapshot](https://github.com/BigWigsMods/BigWigs/tree/b26c01915ddb84db2a230b10321551e30ce6b0f4/TheVenomousAbyss), plus its MidnightLairs/Nymrissa and TheUnbindingOfKithix modules. No implementation code copied.
- [Warcraft Logs filtering and position semantics](https://www.warcraftlogs.com/help/pins), [API documentation](https://www.warcraftlogs.com/api/docs).
- [Gravebound spell record](https://www.wowhead.com/spell=1308330), [Ravage vulnerability](https://www.wowhead.com/spell=1277105), [Guillotine vulnerability](https://www.wowhead.com/spell=1307425), [Caustic Residue](https://www.wowhead.com/spell=1296667). Ninety-seven relevant game tooltip records were cross-checked privately; raw third-party tooltip dumps are not published.

## Performance and privacy

One bounded filtered timeline is shared by survival, activity, tank and mechanic processing. The client limits upstream concurrency to three; two pulls may import concurrently. Completed facts are cached independently and versioned when ingestion semantics change. The mechanic engine indexes the timeline by spell, retains only primitives, caps each pull at 250,000 timeline records and caps displayed links per rule at twelve. A failed/oversized import cannot produce a partial ranking. Per-pull descriptions are normalized into one result catalogue to avoid duplicating them for every player.

The recent-analysis feed contains minimal metadata from completed **public live reports only**, deduplicated by report. Demo, private and unlisted results are excluded; no player names or raw events are in the feed. Its indexed database table has the same seven-day retention as analyses. Completed share snapshots remain immutable; updating a model is an explicit new analysis. Icons use the existing MIT-licensed Lucide library; no unverified third-party WoW artwork package is added.
