# DarkWhispers App · 0.10.0

A compact Warcraft Logs raid review app using React, TypeScript, Vite, Fastify, PostgreSQL 16 and pg-boss. API and worker are isolated services. No paid services or generated grades.

## Run

Node 22.12+ is required. Use `npm ci`, `npm run build` and `npm start`; `npm run dev` serves the frontend on 127.0.0.1:8878. Development without PostgreSQL uses a disposable memory store and inline worker. The clearly labelled synthetic demo never replaces a real report.

Live imports require `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` on the backend only. Client Credentials uses `/oauth/token` and `/api/v2/client`; no callback is required. Credentials, private caches and raw audit data never belong in Git, frontend bundles or public reports.

## Score and UI

The survival score is `100 * recorded alive time / full attended encounter time`. Every measured second has equal weight. Full kills and wipes are retained; no manual stops, inferred wipe trimming, mechanic multipliers or flat death deductions. Actual death count and dead time remain visible after resurrection.

DPS, healers and tanks have separate standings using the same formula. A player changing role receives a separate row and score for each role. Partial attendance is labelled. Incomplete required life evidence or no recorded combat contribution produces an explained unscored row instead of assumed perfection.

The player view explains the score and links to recorded events in Warcraft Logs. Output, intake, utility, items and mechanic observations are context outside the score. Character profile links use known identity. This is a survival measurement, not proof of total skill or fault for a wipe. Intentional wipe deaths are included and require human interpretation.

See the [model](docs/execution-model.md) for formula, evidence rules, examples of limitations and primary API references. There are no Unknown-weight categories or manual wipe-time controls. Explicit repair redirects can resolve known broken links to newly analysed results while keeping original stored snapshots intact; normal share reads never enqueue work.

## New reports and compatibility

Report IDs, guilds, player names and raid-zone names are not allowlisted. Report metadata supplies encounters, roster, difficulty, times and per-pull specs. The survival formula is independent of boss and class rules. Unknown encounters can be scored when their standard life facts are complete. New mechanic meanings cannot be invented from a stable GraphQL format.

Up to 150 completed boss pulls can be selected per analysis; larger reports can be reviewed in subsets. Individual timelines, pagination, queue capacity and API retries/budget are bounded. Ongoing pulls and trash are excluded. Private or archived reports need permissions beyond this public client feature.

## Performance, sharing and integrity

Two pulls import concurrently, at most three upstream requests per process. OAuth refresh is single-flight. Completed pulls are independently cached with report revision, full boundaries, ingestion version and measurement policy. Older shortened-window caches cannot supply new scores. Missing/invalid pages, tables or required life evidence never become perfect scores.

Selections are frozen before enqueueing. Jobs are capped at 12 active and expire after two hours. Saved results have immutable `/?analysis=<uuid>` links with seven-day retention. Reading a link does not enqueue work or query WCL. Older scoring snapshots remain unchanged and offer explicit reanalysis.

The recent feed contains minimal metadata only for completed public live reports, not demo/private/unlisted data. Anyone with a share link can read that saved result. Cloudflare-aware rate limits and fixed upstream origins prevent trusting arbitrary forwarding headers or user-supplied fetch hosts. See `server/client-ip.ts`.

## Verification and deployment

`npm test` runs scoring/API/ingestion/window regressions and small labelled synthetic benchmarks, including seeded monotonicity and aggregation invariants. `npm run check` validates types; `npm run build` builds production assets. `npm run test:postgres` needs an isolated `TEST_DATABASE_URL` and exercises persistence, immutable shares, feed privacy, admission and concurrent indexed reads.

Deploy only the archive built and attested by the GitHub app workflow. The VPS API and worker use their own OS user, database, loopback port and systemd units. Preserve all other services. Test real reports on the server with credentials kept there; raw audits remain private. Synthetic demo success alone is not live-report verification.
