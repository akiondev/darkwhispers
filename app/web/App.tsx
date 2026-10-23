import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  FileText,
  Github,
  Layers3,
  LoaderCircle,
  Search,
  ShieldCheck,
  Swords,
  X,
} from 'lucide-react';
import type {
  Analysis,
  Category,
  Evidence,
  Job,
  RankedPlayer,
  Report,
  Selection,
  Status,
} from '../shared/types.js';
import { difficultyName, selectFights } from '../shared/report-url.js';
import { scoreBand, scoreLabel } from '../shared/score.js';
import { VERSION } from '../shared/version.js';
import ReviewPriorities from './ReviewPriorities.js';
const roleLabel = (player: Pick<RankedPlayer, 'role' | 'spec'>) =>
  player.role === 'unknown'
    ? player.spec === 'Mixed'
      ? 'mixed roles'
      : 'unknown role'
    : player.role;
const PullChart = lazy(() => import('./PullChart.js'));
const defaults: Selection = {
  encounterId: null,
  difficulty: null,
  mode: 'all',
  fightIds: null,
  excludeWipeTail: false,
};
const categories: Category[] = ['mechanics', 'survival', 'output', 'utility'];
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const duration = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.message === 'string' ? data.message : 'This request could not be completed.',
    );
  return data as T;
}
function Score({ player }: { player: Pick<RankedPlayer, 'score' | 'provisional'> }) {
  return (
    <span
      className={`score ${scoreBand(player.score, player.provisional)}`}
      title={
        player.provisional
          ? 'Provisional: some scoring categories or boss participation are missing. ~ is not a verified full score.'
          : 'Weighted performance score from all scoring categories.'
      }
    >
      {scoreLabel(player.score, player.provisional)}
    </span>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', cancel);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.close();
      previous?.focus();
    };
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <header>
        <h2 id="modal-title">{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
function EventList({ events, analysis }: { events: Evidence[]; analysis: Analysis }) {
  const [limit, setLimit] = useState(20);
  return (
    <>
      <div className="event-list">
        {events.slice(0, limit).map((event, index) => {
          const fight = analysis.pulls.find((p) => p.fight.id === event.fightId)?.fight;
          return (
            <div className="event" key={`${event.fightId}-${event.timestamp}-${index}`}>
              <div>
                <span className="event-time">
                  #{event.fightId} · {duration(event.timestamp - (fight?.startTime ?? 0))}
                </span>
                <span className="tag">
                  {event.kind === 'mechanic-observed' ? 'observation' : event.kind}
                </span>
              </div>
              <strong>{event.ability}</strong>
              <p>{event.description}</p>
              {event.url && (
                <a href={event.url} target="_blank" rel="noreferrer">
                  View in Warcraft Logs <ExternalLink size={12} />
                </a>
              )}
            </div>
          );
        })}
      </div>
      {events.length > limit && (
        <button className="secondary" onClick={() => setLimit((n) => n + 30)}>
          Show more events ({events.length - limit} remaining)
        </button>
      )}
      {!events.length && <p className="muted">No supporting events for this selection.</p>}
    </>
  );
}
function PlayerDetails({ player, analysis }: { player: RankedPlayer; analysis: Analysis }) {
  const [eventType, setEventType] = useState('all');
  const filtered = player.evidence.filter((e) => eventType === 'all' || e.kind === eventType);
  return (
    <>
      <div className="player-hero">
        <span className={`class-dot class-${player.class.toLowerCase()}`} />
        <div>
          <p className="eyebrow">
            {player.class} · {player.spec} · {roleLabel(player)}
          </p>
          <h3>{player.name}</h3>
        </div>
        <Score player={player} />
      </div>
      <div className="notice subtle">
        <ShieldCheck size={17} />
        <div>
          {player.provisional ? 'Provisional comparison' : 'Complete scoring coverage'} ·{' '}
          {player.coverage.toFixed(0)}% scoring coverage · {player.pulls} pulls across{' '}
          {player.bosses} bosses
          {player.provisional && (
            <p>
              Missing categories are excluded for everyone on the same boss. ~100 is not a verified
              perfect score.
            </p>
          )}
        </div>
      </div>
      <div className="category-grid">
        {categories.map((category) => {
          const value = player.categories[category];
          return (
            <div className="category" key={category}>
              <span>
                {category}
                <small>{value.weight}% base weight</small>
              </span>
              <strong>
                {value.applied && value.score !== null ? value.score.toFixed(1) : 'Not scored'}
              </strong>
              <div className="meter">
                <i style={{ width: `${value.applied ? (value.score ?? 0) : 0}%` }} />
              </div>
              <p>{value.explanation}</p>
            </div>
          );
        })}
      </div>
      <div className="stats mini">
        <div>
          <span>Alive</span>
          <strong>{((100 * player.aliveMs) / Math.max(1, player.durationMs)).toFixed(1)}%</strong>
        </div>
        <div>
          <span>Deaths</span>
          <strong>{player.deaths}</strong>
        </div>
        <div>
          <span>
            {player.role === 'unknown' ? 'DPS / HPS' : player.role === 'healer' ? 'HPS' : 'DPS'}
          </span>
          <strong>
            {compact.format(
              (player.role === 'healer' ? player.healing : player.damage) /
                Math.max(1, player.durationMs / 1000),
            )}
            {player.role === 'unknown' &&
              ` / ${compact.format(player.healing / Math.max(1, player.durationMs / 1000))}`}
          </strong>
        </div>
        <div>
          <span>Defensive casts</span>
          <strong>{player.defensives}</strong>
        </div>
        <div>
          <span>Interrupts / dispels</span>
          <strong>
            {player.interrupts} / {player.dispels}
          </strong>
        </div>
        <div>
          <span>Damage taken</span>
          <strong>{compact.format(player.damageTaken)}</strong>
        </div>
      </div>
      {player.notes.map((note) => (
        <p className="small muted" key={note}>
          {note}
        </p>
      ))}
      <h3 className="section-label">Boss breakdown</h3>
      <div className="boss-breakdown">
        {player.perBoss.map((b) => (
          <div key={b.encounterId}>
            <span>
              {b.name}
              <small>
                {b.pulls} pulls · {b.coverage}% scoring coverage
              </small>
            </span>
            <Score player={{ score: b.score, provisional: b.coverage < 100 }} />
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h3>Evidence trail</h3>
        <select
          aria-label="Filter evidence"
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
        >
          <option value="all">All observations</option>
          <option value="mechanic">Confirmed mechanics</option>
          <option value="mechanic-observed">Unscored observations</option>
          <option value="death">Deaths</option>
          <option value="defensive">Defensive casts</option>
          <option value="interrupt">Interrupts</option>
          <option value="dispel">Dispels</option>
        </select>
      </div>
      <EventList events={filtered} analysis={analysis} />
    </>
  );
}
export default function App() {
  const [status, setStatus] = useState<Status | null>(null),
    [url, setUrl] = useState(''),
    [report, setReport] = useState<Report | null>(null),
    [selection, setSelection] = useState<Selection>(defaults);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [job, setJob] = useState<Job | null>(null),
    [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [player, setPlayer] = useState<RankedPlayer | null>(null),
    [method, setMethod] = useState(false),
    [pullPicker, setPullPicker] = useState(false),
    [query, setQuery] = useState(''),
    [role, setRole] = useState('all');
  const request = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  useEffect(() => {
    api<Status>('/api/status')
      .then(setStatus)
      .catch(() =>
        setError('The analysis service is currently unavailable. Please try again shortly.'),
      );
    return () => request.current?.abort();
  }, []);
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<Job>(`/api/analyses/${job.id}`, undefined, controller.signal);
        setJob(next);
        if (next.status === 'complete' && next.result) {
          setAnalysis(next.result);
          setBusy(false);
          setTimeout(
            () => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
            100,
          );
        } else if (next.status === 'failed') {
          setBusy(false);
          setError(next.error ?? 'Analysis failed.');
        } else timer = setTimeout(poll, 1200);
      } catch (e) {
        if (!controller.signal.aborted) {
          setBusy(false);
          setError(e instanceof Error ? e.message : 'Could not check analysis progress.');
        }
      }
    };
    timer = setTimeout(poll, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [job?.id, job?.status]);
  const chosen = useMemo(
    () => (report ? selectFights(report, selection) : []),
    [report, selection],
  );
  const bosses = useMemo(
    () => (report ? [...new Map(report.fights.map((f) => [f.encounterId, f.name])).entries()] : []),
    [report],
  );
  const shown =
    analysis?.players.filter(
      (p) =>
        (role === 'all' || p.role === role) && p.name.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const change = (patch: Partial<Selection>) => {
    setSelection((s) => ({ ...s, ...patch }));
    setAnalysis(null);
    setJob(null);
  };
  async function load(demo = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setAnalysis(null);
    setJob(null);
    setReport(null);
    try {
      const next = demo
        ? await api<Report>('/api/demo/report', undefined, controller.signal)
        : await api<Report>('/api/reports/inspect', { url }, controller.signal);
      setReport(next);
      setSelection(defaults);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Report could not be loaded.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function start() {
    if (!report) return;
    setBusy(true);
    setError('');
    setAnalysis(null);
    try {
      const created = await api<{ id: string; status: Job['status'] }>('/api/analyses', {
        reportCode: report.code,
        demo: report.source === 'demo',
        selection,
      });
      setJob({
        id: created.id,
        status: created.status,
        progress: 0,
        message: 'Queued for analysis',
        createdAt: new Date().toISOString(),
        reportCode: report.code,
        selection,
        demo: report.source === 'demo',
      });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Analysis could not start.');
    }
  }
  return (
    <>
      <div className="ambient" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="/">
          <img src="/assets/vampire-logo.webp" width="43" height="43" alt="" />
          <span>
            DARKWHISPERS<small>RAID ANALYSIS</small>
          </span>
        </a>
        <div className="top-links">
          <span className="prototype">
            <i />
            Prototype 0.1
          </span>
          <a
            href="https://github.com/akiondev/darkwhispers/tree/main/app"
            target="_blank"
            rel="noreferrer"
            aria-label="Open source on GitHub"
          >
            <Github size={19} />
            <span>Open source</span>
          </a>
        </div>
      </header>
      <main>
        <section className={`hero ${report ? 'loaded' : ''}`}>
          <div className="eyebrow">
            <span className="line" /> EVIDENCE BEFORE ASSUMPTIONS
          </div>
          <h1>
            Every pull.
            <br />
            <em>The whole picture.</em>
          </h1>
          <p className="lead">See what happened. Compare your raid. Know what to work on.</p>
          <form
            className="report-form"
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            <label className="sr-only" htmlFor="report-url">
              Warcraft Logs report URL
            </label>
            <FileText size={20} />
            <input
              id="report-url"
              type="text"
              inputMode="url"
              placeholder="Paste a Warcraft Logs report link"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={2048}
              required
              autoComplete="off"
              disabled={busy}
            />
            <button className="primary" disabled={busy || !url.trim()}>
              {busy && !job ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <>
                  Load report <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
          <div className="under-form">
            <span>Public reports · All bosses · Wipes & kills</span>
            <button className="text-button" onClick={() => void load(true)} disabled={busy}>
              Explore the synthetic demo <ArrowRight size={13} />
            </button>
          </div>
          {status && !status.liveConfigured && (
            <p className="setup-state">
              Live imports await server-side Warcraft Logs credentials. The synthetic demo is
              available.
            </p>
          )}
        </section>
        {error && (
          <div className="notice error" role="alert">
            <CircleHelp size={19} />
            <div>
              <strong>Unable to continue</strong>
              <p>{error}</p>
            </div>
            <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={17} />
            </button>
          </div>
        )}
        {report && (
          <>
            <section className="panel selection-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {report.source === 'demo' ? 'SYNTHETIC DEMO SESSION' : report.zone}
                  </p>
                  <h2>{report.title}</h2>
                  <p className="muted small">
                    {new Date(report.startTime).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}{' '}
                    · {report.fights.length} completed boss pulls · {report.players.length} players
                  </p>
                </div>
                <span className="tag">
                  {report.source === 'demo' ? 'DEMO · NOT REAL LOGS' : report.code}
                </span>
              </div>
              {report.source === 'demo' && (
                <div className="notice demo">
                  <Layers3 size={18} />
                  <div>
                    All players, mechanics and scores in this session are synthetic.
                    <p>This is not the Sszorak test report. No real player has been evaluated.</p>
                  </div>
                </div>
              )}
              <div className="selection-grid">
                <label>
                  Encounter
                  <select
                    disabled={busy}
                    value={selection.encounterId ?? ''}
                    onChange={(e) =>
                      change({
                        encounterId: e.target.value ? Number(e.target.value) : null,
                        fightIds: null,
                      })
                    }
                  >
                    <option value="">Entire report · all bosses</option>
                    {bosses.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Difficulty
                  <select
                    disabled={busy}
                    value={selection.difficulty ?? ''}
                    onChange={(e) =>
                      change({
                        difficulty: e.target.value ? Number(e.target.value) : null,
                        fightIds: null,
                      })
                    }
                  >
                    <option value="">All difficulties</option>
                    {[...new Set(report.fights.map((f) => f.difficulty))].sort().map((d) => (
                      <option key={d} value={d}>
                        {difficultyName(d)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="pull-kind">
                  <span>Include</span>
                  <div className="segmented">
                    {(['all', 'wipes', 'kills'] as const).map((mode) => (
                      <button
                        disabled={busy}
                        key={mode}
                        className={selection.mode === mode ? 'selected' : ''}
                        aria-pressed={selection.mode === mode}
                        onClick={() => change({ mode, fightIds: null })}
                      >
                        {mode === 'all' ? 'All pulls' : mode === 'wipes' ? 'Wipes' : 'Kills'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="selection-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setPullPicker(!pullPicker)}
                  aria-expanded={pullPicker}
                >
                  {selection.fightIds ? 'Custom selection' : 'All matching pulls'}{' '}
                  <ChevronDown size={14} />
                </button>
                <span className="muted small">
                  {chosen.length} pulls ·{' '}
                  {duration(chosen.reduce((n, f) => n + f.endTime - f.startTime, 0))} encounter time
                </span>
                <button
                  className="primary analyze"
                  onClick={() => void start()}
                  disabled={busy || !chosen.length}
                >
                  {busy && job ? (
                    <>
                      <LoaderCircle size={16} className="spin" />
                      Analyzing
                    </>
                  ) : (
                    <>
                      Analyze {chosen.length} {chosen.length === 1 ? 'pull' : 'pulls'}{' '}
                      <Swords size={16} />
                    </>
                  )}
                </button>
              </div>
              {pullPicker && (
                <div className="pull-picker">
                  <div className="section-heading">
                    <span className="small muted">Select individual pulls</span>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => change({ fightIds: null })}
                    >
                      Select all matching
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => change({ fightIds: [] })}
                    >
                      Clear selection
                    </button>
                  </div>
                  {selectFights(report, { ...selection, fightIds: null }).map((f) => (
                    <label key={f.id}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={selection.fightIds === null || selection.fightIds.includes(f.id)}
                        onChange={(e) => {
                          const ids = new Set(
                            selection.fightIds ??
                              selectFights(report, { ...selection, fightIds: null }).map(
                                (p) => p.id,
                              ),
                          );
                          if (e.target.checked) ids.add(f.id);
                          else ids.delete(f.id);
                          change({ fightIds: [...ids] });
                        }}
                      />
                      <span>
                        #{f.id} · {f.name}
                      </span>
                      <span className={f.kill ? 'kill' : 'muted'}>
                        {f.kill ? 'Kill' : 'Wipe'} · {duration(f.endTime - f.startTime)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>
            {busy && job && (
              <section className="panel progress-panel" role="status">
                <div>
                  <LoaderCircle size={20} className="spin" />
                  <strong>{job.message}</strong>
                  <span>{job.progress}%</span>
                </div>
                <progress value={job.progress} max={100} />
                <p className="small muted">
                  The worker saves completed pulls. A retry reuses cached data instead of starting
                  over.
                </p>
              </section>
            )}
          </>
        )}
        {analysis && (
          <section ref={resultRef} className="results">
            <div className="section-heading">
              <div>
                <p className="eyebrow">THE SELECTED SESSION</p>
                <h2>Raid performance</h2>
              </div>
              <button className="secondary" onClick={() => setMethod(true)}>
                <CircleHelp size={15} /> How scoring works
              </button>
            </div>
            <div className="stats">
              <div>
                <span>Selected pulls</span>
                <strong>
                  {analysis.summary.pulls}
                  <small>
                    {analysis.summary.kills} kills · {analysis.summary.wipes} wipes
                  </small>
                </strong>
              </div>
              <div>
                <span>Encounters</span>
                <strong>
                  {analysis.summary.bosses}
                  <small>Equal weight per boss</small>
                </strong>
              </div>
              <div>
                <span>Players compared</span>
                <strong>
                  {analysis.summary.players}
                  <small>Role-aware output</small>
                </strong>
              </div>
              <div>
                <span>Scoring coverage</span>
                <strong>
                  {analysis.summary.coverage.toFixed(0)}%
                  <small>
                    {analysis.summary.coverage < 100
                      ? 'Provisional · missing categories excluded'
                      : 'All categories available'}
                  </small>
                </strong>
              </div>
            </div>
            {analysis.report.source === 'warcraftlogs' &&
              analysis.players.some((p) => p.provisional) && (
                <div className="notice subtle">
                  <ShieldCheck size={17} />
                  <div>
                    Scores are provisional: missing categories and incomplete boss rules remain
                    visible.
                    {analysis.methodology.rules.some((rule) =>
                      rule.startsWith('sszorak-tempest'),
                    ) && (
                      <p>
                        Sszorak mechanic scoring currently covers direct Tempest contact only. Other
                        mechanics are not graded.
                      </p>
                    )}
                  </div>
                </div>
              )}
            {analysis.warnings.length > 0 && (
              <details className="data-notes">
                <summary>
                  <ShieldCheck size={16} /> Data & interpretation notes{' '}
                  <span>{analysis.warnings.length}</span>
                </summary>
                {analysis.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </details>
            )}
            <section className="panel ranking">
              <div className="section-heading">
                <div>
                  <h3>Player standings</h3>
                  <p className="small muted">
                    Weighted 0–100 score · ~ means provisional · click a player to inspect the facts
                  </p>
                </div>
                <div className="table-controls">
                  <label className="search">
                    <Search size={14} />
                    <input
                      aria-label="Find player"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Find player"
                    />
                  </label>
                  <select
                    aria-label="Filter role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="all">All roles</option>
                    <option value="tank">Tanks</option>
                    <option value="healer">Healers</option>
                    <option value="dps">Damage</option>
                    <option value="unknown">Mixed / unknown</option>
                  </select>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Player</th>
                      <th>Score</th>
                      <th>Mechanics</th>
                      <th>Alive</th>
                      <th>Deaths</th>
                      <th>Output / sec</th>
                      <th>Pulls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => (
                      <tr key={p.id} onClick={() => setPlayer(p)}>
                        <td className="rank">{p.rank ?? '—'}</td>
                        <td>
                          <button
                            className="player-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPlayer(p);
                            }}
                          >
                            <span className={`class-dot class-${p.class.toLowerCase()}`} />
                            <span>
                              {p.name}
                              <small>
                                {p.spec} {p.class} · {roleLabel(p)}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <Score player={p} />
                        </td>
                        <td>
                          {p.mechanicFailures === null ? (
                            <span className="muted">Not scored</span>
                          ) : (
                            <span>
                              {p.mechanicFailures}
                              <small className="cell-sub">
                                failed / {p.mechanicOpportunities} opportunities
                              </small>
                            </span>
                          )}
                        </td>
                        <td>{((100 * p.aliveMs) / Math.max(1, p.durationMs)).toFixed(1)}%</td>
                        <td>{p.deaths}</td>
                        <td>
                          {compact.format(
                            (p.role === 'healer' ? p.healing : p.damage) /
                              Math.max(1, p.durationMs / 1000),
                          )}
                          <small className="cell-sub">
                            {p.role === 'unknown'
                              ? `DPS · ${compact.format(p.healing / Math.max(1, p.durationMs / 1000))} HPS`
                              : p.role === 'healer'
                                ? 'HPS'
                                : 'DPS'}{' '}
                            · raw output
                          </small>
                        </td>
                        <td>{p.pulls}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!shown.length && <p className="empty">No players match this filter.</p>}
              </div>
              <div className="score-legend">
                <span className="perfect">100</span>
                <span className="pink">99</span>
                <span className="purple">90–98</span>
                <span className="blue">70–89</span>
                <span className="green">50–69</span>
                <span className="yellow">30–49</span>
                <span className="grey">0–29</span>
                <span className="muted">Gold requires complete evidence.</span>
              </div>
            </section>
            <div className="bottom-grid">
              <section className="panel">
                <div className="section-heading">
                  <h3>Pull overview</h3>
                  <span className="small muted">
                    <i className="legend-kill" /> Kill <i className="legend-wipe" /> Wipe
                  </span>
                </div>
                <Suspense fallback={<div className="chart-loading">Loading pull chart…</div>}>
                  <PullChart pulls={analysis.pulls} />
                </Suspense>
                <div className="pull-table">
                  {analysis.pulls.map((p) => (
                    <div key={p.fight.id}>
                      <span>#{p.fight.id}</span>
                      <span>{p.fight.name}</span>
                      <span>{duration(p.fight.endTime - p.fight.startTime)}</span>
                      <span className={p.fight.kill ? 'kill' : 'muted'}>
                        {p.fight.kill
                          ? 'Kill'
                          : p.fight.percentage === null
                            ? 'Wipe'
                            : `${p.fight.percentage.toFixed(1)}%`}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
              <ReviewPriorities
                key={analysis.generatedAt}
                analysis={analysis}
                onInspect={(id) => setPlayer(analysis.players.find((p) => p.id === id) ?? null)}
              />
            </div>
          </section>
        )}
        {!report && (
          <section className="intro-grid">
            <div>
              <Layers3 size={21} />
              <h3>The full session</h3>
              <p>A single boss, every wipe, the kills, or the entire report.</p>
            </div>
            <div>
              <ShieldCheck size={21} />
              <h3>Facts you can inspect</h3>
              <p>Every scored factor has a reason. Missing evidence stays visible.</p>
            </div>
            <div>
              <Swords size={21} />
              <h3>More than damage</h3>
              <p>Mechanics, survival, role-aware output and assigned utility.</p>
            </div>
          </section>
        )}
        <footer>
          <span>
            DARKWHISPERS <small>Prototype · engine {VERSION}</small>
          </span>
          <p>
            Independent community project. Not affiliated with Blizzard or Warcraft Logs.
            <br />
            Cached analyses expire after seven days. Public report links only; no Warcraft Logs
            login required.
          </p>
          <a
            href="https://github.com/akiondev/darkwhispers/tree/main/app"
            target="_blank"
            rel="noreferrer"
          >
            Source & methodology <ExternalLink size={12} />
          </a>
        </footer>
      </main>
      {player && analysis && (
        <Modal title="Player analysis" onClose={() => setPlayer(null)} wide>
          <PlayerDetails key={player.id} player={player} analysis={analysis} />
        </Modal>
      )}
      {method && analysis && (
        <Modal title="How scoring works" onClose={() => setMethod(false)}>
          <p>{analysis.methodology.bossWeighting}</p>
          <div className="weight-list">
            {categories.map((c) => (
              <div key={c}>
                <span>{c}</span>
                <strong>{analysis.methodology.weights[c]}%</strong>
              </div>
            ))}
          </div>
          <p>
            100 is a weighted perfect score with complete scoring evidence, never a prize simply for
            topping DPS. 99 is pink; 90–98 purple; 70–89 blue; 50–69 green; 30–49 yellow; 0–29 grey.
            Provisional values carry ~, and never receive the gold perfect-score badge.
          </p>
          <h3>Limits & interpretation</h3>
          {analysis.methodology.limitations.map((l) => (
            <p className="method-limit" key={l}>
              {l}
            </p>
          ))}
          <p className="small muted">
            Engine {analysis.version} · rules:{' '}
            {analysis.methodology.rules.join(', ') ||
              'No validated mechanic scoring rules in this selection'}
          </p>
        </Modal>
      )}
    </>
  );
}
