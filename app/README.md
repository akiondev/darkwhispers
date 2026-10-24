# DarkWhispers App · prototype 0.7.0

A concise Warcraft Logs raid review app. React 19, TypeScript, Vite 8, Fastify 5, PostgreSQL 16 and pg-boss. The API and analysis worker run separately. No paid services or generated player grades.

## Run locally

Node 22.12+ is required.

```sh
npm ci
npm run build
npm start
# In another terminal:
npm run dev
```

Open http://127.0.0.1:8878. Without PostgreSQL configuration, development uses a disposable in-memory store and an inline worker. The clearly labelled synthetic demo requires no credentials and never replaces a real log.

Live reports require `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` **on the backend only**. Client Credentials uses WCL's `/oauth/token` and `/api/v2/client` endpoints; no callback or user login is required. Never prefix credentials with `VITE_`, commit them, place them in report URLs or include them in public bundles.

## Read the raid, then the score

The main view is a compact set of separate **DPS → Healers → Tanks** standings. Players have an inspectable 0–100 execution score, mechanic results, time alive, raw DPS/HPS and pull counts. A character who changes role receives distinct role results.

The [execution model](docs/execution-model.md) replaces the older multi-factor role index. Its only scoring inputs are verified mechanic outcomes (70% base weight) and recorded time alive (30%). The result is capped by the percentage of the pull actually spent alive. There are no neutral midpoint points, historical-parse weights, activity estimates or class-defensive weights.

Raw output, intake, preparation and observed consumable use remain visible facts outside the score. Tank autoattacks and mandatory tank contacts are not generic failures. Missing or incomplete mechanic exposure cannot manufacture a pass, and zero opportunities cannot manufacture 100. A short reason replaces unavailable scores instead of displaying weighted Unknown categories.

Every eligible pull is calculated first, then combined within boss/difficulty/role contexts. Attended bosses receive equal weight in the whole-report overview. At each aggregation, all attended contexts still contribute their recorded availability ceiling, even if they have no mechanic score; dying before the first check cannot disappear from the final cap. Unplayed bosses add neither zero nor 50; attendance and scored-pull counts remain visible. Full recorded encounter duration is used consistently rather than guessing the raid leader's wipe call.

This is an **execution score**, not proof of total skill or responsibility for a wipe. Exactly zero output/casts/utility is unranked, but one cast does not establish meaningful participation. DPS/HPS must remain prominent and the app must not market two inputs as an AFK-proof overall raider grade. Exact method details are available on demand, rather than repeated throughout the player panel.

The [S2 encounter inventory](docs/midnight-s2-rules.md) remains the source of verified mechanic identities and context. Its older 0.6 scoring/weight descriptions are historical; the execution model above defines current scoring. New event variants fail closed rather than becoming guessed player mistakes.

## Saved links and recent reports

Each analysis has an opaque `/?analysis=<uuid>` link. Refreshes resume the same job; readers retrieve the stored result without enqueuing work or calling WCL. Completed snapshots are immutable and expire after seven days. Updating the scoring model requires explicit reanalysis and creates a new result/link.

Anyone possessing a share link can read its report/player data. The front page shows only minimal metadata for completed **public live reports**, deduplicated by report. Demo, private and unlisted results are excluded. Clipboard fallback supports manually copying the selected link.

## Performance and integrity

Report metadata and ability identities are fetched once as needed. Two pulls can import concurrently, with at most three upstream requests per process. OAuth refresh is single-flight. Each completed pull is committed independently and reused across boss/mode selections. Versioned cache keys include report revision and fight boundaries; incompatible ingestion changes invalidate facts, while UI-only changes reuse them.

Queries use fixed WCL origins, bounded retries, timeouts and budget-aware backoff. Event pagination follows `nextPageTimestamp`, including empty pages. Non-advancing cursors, invalid totals/events, partial GraphQL responses and incomplete imports stop the analysis. A user-supplied report URL never becomes an arbitrary upstream request.

The chosen pull IDs are frozen before enqueueing. Queue admission is serialized in this app's database and capped at twelve active jobs; expired jobs fail explicitly. Progress cannot move backwards when parallel imports complete. Recent analyses use a small indexed table and the same seven-day expiry as their share snapshots. The compact interface has no chart-library dependency.

Rate limiting distinguishes trusted Cloudflare forwarding from direct-origin headers; see `server/client-ip.ts`. Client credentials, raw audits and caches stay out of Git and public artifacts.

## Validate and deploy

```sh
npm run check
npm test
npm run build
npm audit --audit-level=moderate
# With an isolated test database URL:
npm run test:postgres
```

Synthetic benchmarks measure engine computation, not network latency. Real acceptance uses `6fjJxRFC21YHdTXB` and `LfhZ47qyPY8FRQH6`, covering whole reports, selected bosses/pulls and kills/wipes. Synthetic class/difficulty fixtures do not constitute live LFR/Normal validation.

Build, validate, package and attest through `.github/workflows/app.yml`. `deploy/provision.py` manages only this app's database, unprivileged user, API/worker units and domain configuration, preserving other VPS services. The backend listens on loopback port 3210 behind Caddy HTTPS. Secrets live in the root-owned `/etc/darkwhispers-app.env`, never the served assets. The app does not install addons or update the launcher.

Open source and GitHub attestations make the implementation and build origin auditable; they do not guarantee freedom from bugs.

## API references

- [Warcraft Logs OAuth and API](https://www.warcraftlogs.com/api/docs)
- [Report schema and pagination](https://www.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html)
- [Combatant information](https://www.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.CombatantInfoEvent.html)
