# DarkWhispers App · prototype 0.1

Evidence-first Warcraft Logs raid analysis. React 19 + TypeScript, Vite 8, Fastify 5, PostgreSQL 16 and pg-boss. API and analysis worker are separate processes. No paid services or AI-generated player grades.

## Run locally

Node 22.12+ is required.

```sh
npm ci
npm run build
npm start
# Another terminal:
npm run dev
```

Visit http://127.0.0.1:8878. Without PostgreSQL configuration, local development uses a disposable in-memory store and inline worker. The explicitly labelled synthetic demo requires no credentials. No real log is substituted with demo data.

To import public Warcraft Logs reports, set `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` **only on the backend**. Obtain them through the Warcraft Logs API client settings. Client Credentials uses `/oauth/token` and `/api/v2/client`; it does not require a callback or user login. Never prefix secrets with VITE_, include them in a public bundle, commit them, or paste them into a report URL.

## Data and scoring

Select the whole report, one boss, difficulty, wipes, kills, all pulls or explicit pull IDs. The prototype accepts up to 150 completed boss pulls. Each analysis runs in the background; results are reachable through an opaque job UUID. There is no public analysis directory. Report metadata expires after five minutes; cached pulls and results expire after seven days. Do not submit sensitive report links to a shared public instance.

Scores are weighted **0–100**, not a forced percentile that awards 100 to the best player in any group. Base weights: mechanics 35%, survival 35%, class/spec output 20%, assigned utility 10%. Each boss contributes equally to the whole-report score, so a boss with many wipes does not dominate. Overall ranking requires scored participation on at least half the selected bosses. Missing bosses are not zeroes. Differing attendance and assignments still limit comparability.

A category is scored only when comparable inputs exist for every participant on the same boss. Missing categories are excluded for the entire boss cohort. Incomplete category or attendance coverage carries **~** (provisional), never the gold perfect-score badge. Exact 100 with complete evidence is gold-orange; 99 pink; 90–98 purple; 70–89 blue; 50–69 green; 30–49 yellow; 0–29 grey. Decimal values use their integer band; 99.999 is not rounded into a perfect 100.

Survival measures time alive and handles battle resurrections; it does not assign blame. Raw DPS/HPS, damage taken, defensive casts, interrupts and dispels are visible observations. Damage taken is not automatically an error, and defensive non-use is not inferred from absence. Output uses optional Warcraft Logs historical class/spec kill percentiles (HPS for healers, DPS for others); wipes have no kill parse. Utility requires validated assigned opportunities before it can affect a score. First deaths are review starting points, never asserted wipe causes.

**Current live limitation:** there are no validated Sszorak mechanic-failure or assigned-utility rules. Debuffs are unscored observations. A live report can therefore have low scoring coverage; this prototype does not claim to judge total player performance reliably from survival alone. The synthetic fixture demonstrates the complete mechanic/utility scoring path, not live boss validity. The requested live acceptance report is `6fjJxRFC21YHdTXB`, encounter `3420`, difficulty `5`; it must be verified using real API credentials before live analysis is signed off.

## Performance and integrity

Report actors are fetched once; ability master data once when uncached pulls exist. Two pulls run concurrently, with a hard client-wide limit of three upstream requests. OAuth refresh is single-flight. Completed pulls are committed independently and reused across different boss/mode selections. Cache keys include report revision, fight boundaries and engine version. Metadata is refreshed after five minutes; rankings are snapshots, not live combat monitoring.

Events are processed page by page (10,000 requested events), following `nextPageTimestamp` even for empty pages. Non-advancing cursors, missing pages or partial GraphQL errors stop analysis. Optional unavailable output percentiles are disclosed. Debuff applications are aggregated per actor/ability; result payloads contain supporting player evidence once, without a second raw metric copy per pull. The chart is loaded only after analysis and uses only the ECharts bar components. Requests use fixed Warcraft Logs origins, bounded retries, timeouts and budget-aware backoff. No supplied report URL is fetched directly.

`npm test` includes a 150-pull / 20-player / 90,000-event synthetic engine benchmark. This measures computation only, not real API latency; do not use it as a live-import speed claim. Results depend on hardware and workload. `npm run check`, `npm test`, `npm run build`, `npm audit --audit-level=moderate` are the focused validation steps.

## Production

Build, test, audit, package and attest via `.github/workflows/app.yml`. The app has its own database, unprivileged OS user, environment file and systemd API/worker units; it does not install addons, change the launcher or access other applications' databases. Caddy serves static assets and proxies `/api/*` and `/healthz` to loopback port 3210. CSP restricts scripts and API access to this origin; charts require inline styles. Authentication secrets never enter frontend artifacts.

`deploy/provision.py` creates only DarkWhispers app resources. It preserves existing services, snapshots their state, checks port availability and records the old domain configuration. Site activation is a separate step after both services and the database-backed demo job pass. Rollback: restore the saved `/etc/caddy/darkwhispers.caddy` and reload Caddy; stop the two new app units if necessary. Existing addon/launcher artifacts are retained but not exposed by the new root.

API credentials are configured in `/etc/darkwhispers-app.env` (root-owned, not public). After adding both keys, restart only `darkwhispers-app-api` and `darkwhispers-app-worker`. Verify the real acceptance report and supported mappings before describing live boss rankings as complete.

## References

- [Warcraft Logs OAuth and API](https://www.warcraftlogs.com/api/docs)
- [Report schema and pagination](https://www.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html)
- [API budget fields](https://www.warcraftlogs.com/v2-api-docs/warcraft/ratelimitdata.doc.html)

The code is public and auditable. GitHub attestations prove build origin and artifact integrity, not freedom from bugs or malicious code.
