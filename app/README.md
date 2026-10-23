# DarkWhispers App · prototype 0.6.0

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

## Share an analysis

Every analysis has its own opaque UUID link, `/?analysis=<id>`. Refreshes resume the same job; readers do not enqueue work or call WCL. Completed snapshots are immutable. Links expire after seven days. Anyone possessing a link can read its report/player data. The front page lists minimal metadata for recent completed **public live reports only**, deduplicated by report; private, unlisted and synthetic analyses are excluded. The clipboard button falls back to a selected URL for manual copying.

## Universal role scoring

The live engine ranks every completed raid encounter and difficulty, with no single-boss allowlist. Midnight Season 2 coverage includes all ten The Venomous Abyss bosses, including Kith'ix and Nymrissa Wavecaller, on LFR, Normal, Heroic and Mythic. All six tank classes, mixed roles and short attendance receive a provisional role index and raid/role position.

Read the [complete researched methodology](docs/universal-role-model.md) for fixed role weights, formulas, missing-evidence bounds, sample limits, tank interpretation and validation. Factors combine survival, ten-second role-context action continuity, historical class/spec kill output, class-aware tank response under melee exposure, and verified applicable mechanics. Wipes do not have kill percentiles. Missing another actor's benchmark never discards a valid player's benchmark. Required intake, overheal, raw self-heal size and unassigned utility counts do not manufacture points or errors.

Unknown and undersampled weight is explicitly held at neutral 50. Those points are not observed good performance and are never silently handed to survival. Every result displays measured points, neutral points, measured weight and a lower/upper missing-evidence range. The index is the midpoint; the range is not a statistical confidence interval or a guarantee about all unmodelled skill. Fixed weights are transparent design choices, not scientifically calibrated probabilities. Overlapping ranges do not establish that one player is better.

Difficulty and role contexts are evaluated separately. Difficulties within a boss and selected bosses within a report receive equal weight. Unattended bosses remain explicitly unknown midpoint weight and bounds, never zeroes. All attended pulls contribute; short attendance is disclosed rather than excluded. Optional sustained terminal 50% raid-mortality cutoffs apply consistently to survival, activity, tank response and applicable mechanics on all raid wipes. Feign Death is excluded, battle resurrections count, kills retain full duration, and raw full-pull damage/healing/deaths stay visible. This comparison policy does not infer a voice wipe call.

The [Midnight S2 rule inventory and validation limits](docs/midnight-s2-rules.md) cover all ten bosses and difficulty gating. Player/pull reviews separate verified contacts and resolutions, tank swaps, required soaks, successful utility, shared raid incidents and context-only mechanics. Each row links to its timeline and reference. Gravebound fragment damage and required tank/channel hits are not automatic mistakes. Missing positional/assignment evidence stays explicit. Role standings are separate, ordered DPS, healers, tanks, then mixed/unknown; there is no cross-role ordinal comparison.

Colour bands remain 100 gold-orange for complete evidence, 99 pink, 90-98 purple, 70-89 blue, 50-69 green, 30-49 yellow and 0-29 grey. Partial live indices retain ~ and never receive the complete-perfect badge. Each player opens with the reason for the result and expandable factor/pull evidence. Older shared snapshots stay immutable and offer an explicit Update analysis action creating a new result/link.

Real acceptance uses 6fjJxRFC21YHdTXB (22 Heroic/Mythic pulls, including 18 Mythic Sszorak wipes) and LfhZ47qyPY8FRQH6 (13 Heroic pulls across all ten bosses). Both are checked as whole reports, bosses, individual pulls, kills/wipes and comparison-window selections. Synthetic cases exercise every S2 boss ID, LFR/Normal/Heroic/Mythic and all six tank classes; they are not live LFR/Normal validation. The clearly labelled demo remains a synthetic earlier scoring fixture, never substituted for a real report.

## Performance and integrity

Report actors are fetched once; ability master data once when uncached pulls exist. Two pulls run concurrently, with a hard limit of three upstream requests per process. OAuth refresh is single-flight. Completed pulls are committed independently and reused across different boss/mode selections. Cache keys include report revision, fight boundaries and a separate ingestion/rule version. UI-only and score-aggregation releases reuse compatible downloaded facts. Metadata is refreshed after five minutes; rankings are snapshots, not live combat monitoring.

The submitted pull IDs are fixed when analysis starts, so new uploads cannot silently expand a queued analysis. Expired metadata is refreshed automatically; unavailable selected pulls produce an explicit error. Queue admission is serialized within the application's own database and capped at 12 pending/running analyses. An expired two-hour job returns a terminal error rather than polling forever. Temporary status-request failures retry with bounded backoff, then offer resumption of the same job without creating another analysis. A chart-loading failure leaves standings and the pull list usable. Unknown specialization names never imply a damage role or a scored output percentile.

Client rate limits distinguish visitors behind Cloudflare. `CF-Connecting-IP` is accepted only when the peer identified by Caddy's sanitized forwarding chain is in Cloudflare's published IPv4/IPv6 ranges. Untrusted direct-origin headers cannot choose a different limit key. The range snapshot is documented in `server/client-ip.ts`; unknown future proxy ranges fall back to the proxy IP rather than trusting arbitrary headers.

Events are processed through one server-filtered timeline per pull (deaths, resurrections, interrupts, dispels/steals, debuff applications and known defensive spell IDs), including role-context player casts and tank-response evidence, rather than five independent event streams. Together with the batched metric tables, an uncached wipe normally needs two GraphQL requests before pagination, excluding report-level master data. This is a structural request-count reduction, not a measured live latency claim. Optional kill percentiles add one request on kills.

Pages request 10,000 events, following `nextPageTimestamp` even for empty pages. Non-advancing cursors, malformed events/totals, missing pages or partial GraphQL errors stop analysis. Optional unavailable output percentiles are disclosed. Debuff applications are aggregated per actor/ability; result payloads contain supporting player evidence once, without a second raw metric copy per pull. The chart is loaded only after analysis and uses only the ECharts bar components. Requests use fixed Warcraft Logs origins, bounded retries, timeouts and budget-aware backoff. No supplied report URL is fetched directly. Parallel progress updates cannot move the displayed completed-pull count backwards.

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
