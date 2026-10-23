# Sszorak: narrow Tempest rule, v2

Scope: Warcraft Logs encounter 3420, difficulty 5. The metadata must identify cast 1287072 and contact/debuff 1287083 as Tempest. Other bosses and difficulties are excluded.

The dungeon-journal spell describes moving poisonous vortices with an initial hit and a following damage-over-time effect. The live acceptance report confirms `begincast` 1287072 and direct/periodic `damage` 1287083. These IDs are distinct from the Shaman Tempest spells. We do not infer avoidance errors from similarly named spells or arbitrary debuff applications.

Each logged `begincast` begins a comparison window ending at the earliest of the next Tempest `begincast`, encounter/scoring-window end, or 58.5 seconds after the start. The last bound is the journal effect's 55-second lifetime plus the 3.5-second parent cast. It prevents a late resurrection from earning a free opportunity after the vortices have expired. All 560 real direct contacts in the acceptance report occurred within 49.674 seconds of a preceding cast.

A player with logged time alive in that interval has one opportunity. A direct damage event (`tick !== true`) from the same source within the interval marks one failed opportunity. The WCL query must use `type = "damage"`, which excludes misses/immunities even when they serialize as damage records. Zero effective damage alone is not a miss: 20 fully absorbed contacts in this report remain counted. Multiple contacts and periodic ticks cannot turn one window into multiple failures. The earliest direct contact is linked as evidence. Death and resurrection events establish time-alive intervals; a first recorded resurrection means the player was dead before that resurrection. Events explicitly marked `feign: true` are never real deaths.

This is an explicit scoring convention for encounter windows, not a claim that each player had equal physical proximity to every tornado. It records contact, not culpability. Another player's positioning or a knockback can cause contact. If a contact has no preceding cast from its source, the pull has no mechanic grade. A pull with no waves has zero known opportunities, not a perfect mechanic grade.

The mechanic score is the percentage of these known windows without direct contact, aggregated over selected pulls. It says nothing about required Serpent's Fury/Mutilate soaks, Virulence, cyst placement, crosswind assignments, tank swaps or defensive availability. Those are deliberately ungraded until there is sufficient evidence and an assignment-aware model. The UI discloses this narrow scope. Category-weight coverage is not equivalent to full boss-rule coverage.

Sources:

- [Tempest dungeon-journal spell 1287072](https://www.wowhead.com/spell=1287072/tempest) and [area effect 1287073](https://www.wowhead.com/spell=1287073/tempest) (Blizzard spell text and linked effect 1287083; damage tuning is not part of this rule).
- [Method's firsthand Mythic Sszorak strategy](https://www.method.gg/guides/the-venomous-abyss/sszorak) and [Heroic mechanic explanations](https://www.method.gg/guides/the-venomous-abyss/sszorak-heroic), used for the distinction between tornado avoidance and intentional soaks.
- [Warcraft Logs event and miss semantics](https://www.warcraftlogs.com/help/pins); full absorbs remain damage events.
- Actual API v2 events in acceptance report `6fjJxRFC21YHdTXB`, starting with fight 17: four cast starts, direct and periodic 1287083 events, matching source 202. Raw player logs and credentials are not published as fixtures.
