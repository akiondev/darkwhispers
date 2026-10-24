# DarkWhispers App · 0.13.0

A compact Warcraft Logs raid review app using React, TypeScript, Vite, Fastify, PostgreSQL 16 and pg-boss. API and worker are isolated services. No paid services or generated grades.

## Run

Node 22.12+ is required. Use `npm ci`, `npm run build` and `npm start`; `npm run dev` serves the frontend on 127.0.0.1:8878. Development without PostgreSQL uses a disposable memory store and inline worker. The clearly labelled synthetic demo never replaces a real report.

Live imports require `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` on the backend only. Client Credentials uses `/oauth/token` and `/api/v2/client`; no callback is required. Credentials, private caches and raw audit data never belong in Git, frontend bundles or public reports.

## Score and UI

One numeric 0-100 score combines verified mechanic completion, recorded DPS/HPS contribution and full-encounter survival. Weights are DPS 50/30/20, healer 50/20/30 and tank 60/10/30. Checks while dead earn no completion credit but are not labelled mechanic failures. No generic intake penalty or flat death charge. See [the model](docs/execution-model.md).

Scope is shared by the same-role group in each pull. Unsupported rules are excluded for everyone in that group; without mechanics use output/survival (DPS 60/40, healer 40/60, tank 25/75). Valid pulls do not become preliminary because another pull lacks a mechanic check or food snapshot. Preparation and item use stay outside the score.

DPS, healer and tank have separate standings. Role changes produce separate rows. Scores use verified pulls, weighted by their full durations; an invalid pull is explicitly excluded from that player's score, not assigned zero or perfect credit. Every row shows scored/selected pulls, distinguishing role changes, absence and excluded data. A comparable place requires the exact same full selection. **Compare same pulls** creates a fresh analysis on the player's verified fight IDs using cached facts, with a return to the original selection.

Full death/resurrection facts remain unchanged, including deaths in excluded pulls. Inconsistent life events keep the affected dead-time measurement unavailable; other verified pulls can still earn a score. Details show component arithmetic, scope and WCL evidence links. Output is report-relative, not spec-normalized global ranking.

## New reports and compatibility

Report IDs, guilds and player names are not allowlisted. Standard output and survival facts work across supported API reports. New boss mechanics need validated rules; the common two-component fallback applies until then. Compare within the measured report and role, with participation and scope visible.

Up to 150 completed boss pulls can be selected per analysis; larger reports can be reviewed in subsets. Individual timelines, pagination, queue capacity and API retries/budget are bounded. Ongoing pulls and trash are excluded. Private or archived reports need permissions beyond this public client feature.

## Performance, sharing and integrity

Two pulls import concurrently, at most three upstream requests per process. OAuth refresh is single-flight. Completed pulls are independently cached with report revision, full boundaries, ingestion version and measurement policy. Older shortened-window caches cannot supply new scores. Missing/invalid pages, tables or required life evidence never become perfect scores.

Selections are frozen before enqueueing. Jobs are capped at 12 active and expire after two hours. Saved results have immutable `/?analysis=<uuid>` links with seven-day retention. Reading a link does not enqueue work or query WCL. Older scoring snapshots remain unchanged and offer explicit reanalysis.

The recent feed contains minimal metadata only for completed public live reports, not demo/private/unlisted data. Anyone with a share link can read that saved result. Cloudflare-aware rate limits and fixed upstream origins prevent trusting arbitrary forwarding headers or user-supplied fetch hosts. See `server/client-ip.ts`.

## Verification and deployment

`npm test` runs scoring/API/ingestion/window regressions and small labelled synthetic benchmarks, including seeded monotonicity and aggregation invariants. `npm run check` validates types; `npm run build` builds production assets. `npm run test:postgres` needs an isolated `TEST_DATABASE_URL` and exercises persistence, immutable shares, feed privacy, admission and concurrent indexed reads.

Deploy only the archive built and attested by the GitHub app workflow. The VPS API and worker use their own OS user, database, loopback port and systemd units. Preserve all other services. Test real reports on the server with credentials kept there; raw audits remain private. Synthetic demo success alone is not live-report verification.
