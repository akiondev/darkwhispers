# DarkWhispers App · prototype 0.8.0

A compact Warcraft Logs raid review app using React, TypeScript, Vite, Fastify, PostgreSQL16 and pg-boss. API and worker are isolated services. No paid services or generated grades.

## Run

Node22.12+ is required. Use npm ci, npm run build and npm start; npm run dev serves the frontend on127.0.0.1:8878. Development without PostgreSQL uses a disposable memory store and inline worker. The clearly labelled synthetic demo never replaces a real report.

Live imports require WCL_CLIENT_ID and WCL_CLIENT_SECRET on the backend only. Client Credentials uses /oauth/token and /api/v2/client; no callback is required. Credentials, private caches and raw audit data never belong in Git, frontend bundles or public reports.

## Score and UI

The [execution model](docs/execution-model.md) uses max(0, mechanics * time alive /100 -5 * deaths) per pull. Each reviewed mechanic family has equal budget. Applicable checks remain uncredited while dead. A death's five-point deduction persists after battle resurrection. Required tank contact, uncertain assignments, DPS/HPS, intake, preparation and items have no automatic score weight.

Wipes require a recorded wipe call or a clearly labelled manual shared stop. Without one, statistics remain available and the wipe is unscored. All post-stop events and unfinished checks are excluded. There are no inferred collapse thresholds, Unknown weights or neutral replacement points.

DPS, healers and tanks have separate lists. Same-role characters who change role get independent rows. Duration-weighted pull scores are combined by boss/difficulty; partial attendance/evidence has a visible score without a misleading ordinal comparison. Details show short reasons, a pull selector, preparation/items and one expandable calculation/evidence section. This is not an overall skill or AFK-proof contribution score.

## New reports and compatibility

Report IDs, guilds, player names and raid-zone names are not allowlisted. Report metadata supplies encounters, roster, difficulty, times and per-pull specs. New logs for supported encounters need no code change. Unknown encounters still import factual output, survival and utility, but cannot invent mechanic grades. New mechanics, difficulty variants and specs require reviewed interpretation; a stable GraphQL schema alone does not establish their meaning.

Up to150 completed boss pulls can be selected per analysis; larger reports can be reviewed in subsets. Individual timelines, pagination, queue capacity and API retries/budget are bounded. Ongoing pulls and trash are excluded. Private or archived reports need permissions beyond this public client feature.

## Performance, sharing and integrity

Two pulls import concurrently, at most three upstream requests per process. OAuth refresh is single-flight. Completed pulls are independently cached with report revision, boundaries, ingestion version and exact assessment window. Reanalysis at a new manual stop cannot accidentally use full-pull statistics. Missing/invalid pages, tables or required evidence never become perfect scores.

Selections and manual stop provenance are frozen before enqueueing. Jobs are capped at12 active and expire after two hours. Saved results have immutable /?analysis=<uuid> links with seven-day retention. Reading a link does not enqueue work or query WCL. Older scoring snapshots remain unchanged and offer explicit reanalysis.

The recent feed contains minimal metadata only for completed public live reports, not demo/private/unlisted data. Anyone with a share link can read that saved result. Cloudflare-aware rate limits and fixed upstream origins prevent trusting arbitrary forwarding headers or user-supplied fetch hosts. See server/client-ip.ts.

## Verification and deployment

npm test runs focused scoring/API/ingestion/window regressions and small labelled synthetic benchmarks. npm run check validates types; npm run build builds production assets. npm run test:postgres needs an isolated TEST_DATABASE_URL and exercises persistence, immutable shares, feed privacy, admission and concurrent indexed reads.

Deploy only the archive built and attested by the GitHub app workflow. The VPS API and worker use their own OS user, database, loopback port and systemd units. Preserve all other services. Test real reports on the server with credentials kept there; raw audits remain private. Synthetic demo success alone is not live-report verification.
