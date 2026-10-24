# DarkWhispers App · 0.11.0

A compact Warcraft Logs raid review app using React, TypeScript, Vite, Fastify, PostgreSQL 16 and pg-boss. API and worker are isolated services. No paid services or generated grades.

## Run

Node 22.12+ is required. Use `npm ci`, `npm run build` and `npm start`; `npm run dev` serves the frontend on 127.0.0.1:8878. Development without PostgreSQL uses a disposable memory store and inline worker. The clearly labelled synthetic demo never replaces a real report.

Live imports require `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` on the backend only. Client Credentials uses `/oauth/token` and `/api/v2/client`; no callback is required. Credentials, private caches and raw audit data never belong in Git, frontend bundles or public reports.

## Score and UI

The fixed composite combines reviewed mechanics, report-relative DPS/HPS, full-encounter survival and verified flask/food preparation. Weights are DPS 45/30/20/5, healer 45/20/30/5 and tank 55/10/30/5. No generic damage-taken penalty. Output compares same-role peers in the same pull for both kills and wipes; it is not a spec-normalized global parse. See [the model](docs/execution-model.md) for exact formula and limitations.

DPS, healer and tank have separate standings. Role changes produce separate rows. Missing evidence retains fixed-weight bounds and a preliminary interval, never an invented midpoint, perfect grade or survival-only replacement. Partial attendance is labelled. Player details show component contributions, observed mistakes/deaths and Warcraft Logs links. Correct full death/resurrection intervals are preserved, including intentional wipe deaths.

## New reports and compatibility

Report IDs, guilds and player names are not allowlisted. Standard output and survival facts work across supported API reports. Verified mechanics require versioned encounter rules; future unknown bosses cannot receive fabricated mechanical grades. Preparation uses positive verified snapshot evidence; an unknown buff does not prove missing preparation.
Up to 150 completed boss pulls can be selected per analysis; larger reports can be reviewed in subsets. Individual timelines, pagination, queue capacity and API retries/budget are bounded. Ongoing pulls and trash are excluded. Private or archived reports need permissions beyond this public client feature.

## Performance, sharing and integrity

Two pulls import concurrently, at most three upstream requests per process. OAuth refresh is single-flight. Completed pulls are independently cached with report revision, full boundaries, ingestion version and measurement policy. Older shortened-window caches cannot supply new scores. Missing/invalid pages, tables or required life evidence never become perfect scores.

Selections are frozen before enqueueing. Jobs are capped at 12 active and expire after two hours. Saved results have immutable `/?analysis=<uuid>` links with seven-day retention. Reading a link does not enqueue work or query WCL. Older scoring snapshots remain unchanged and offer explicit reanalysis.

The recent feed contains minimal metadata only for completed public live reports, not demo/private/unlisted data. Anyone with a share link can read that saved result. Cloudflare-aware rate limits and fixed upstream origins prevent trusting arbitrary forwarding headers or user-supplied fetch hosts. See `server/client-ip.ts`.

## Verification and deployment

`npm test` runs scoring/API/ingestion/window regressions and small labelled synthetic benchmarks, including seeded monotonicity and aggregation invariants. `npm run check` validates types; `npm run build` builds production assets. `npm run test:postgres` needs an isolated `TEST_DATABASE_URL` and exercises persistence, immutable shares, feed privacy, admission and concurrent indexed reads.

Deploy only the archive built and attested by the GitHub app workflow. The VPS API and worker use their own OS user, database, loopback port and systemd units. Preserve all other services. Test real reports on the server with credentials kept there; raw audits remain private. Synthetic demo success alone is not live-report verification.
