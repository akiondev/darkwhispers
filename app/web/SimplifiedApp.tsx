import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  FileText,
  Github,
  LoaderCircle,
  Search,
  Share2,
  Swords,
  X,
} from 'lucide-react';
import type {
  Analysis,
  Job,
  LegacyAnalysis,
  RankedPlayer,
  Report,
  Role,
  Selection,
  Status,
} from '../shared/types.js';
import { difficultyName, selectFights } from '../shared/report-url.js';
import { scoreLabel } from '../shared/score.js';
import { VERSION } from '../shared/version.js';
import { analysisLink, sharedAnalysisId } from '../shared/share.js';
import ShareLink from './ShareLink.js';
import RecentAnalyses from './RecentAnalyses.js';
import CompactPlayerDetails from './CompactPlayerDetails.js';
import { windowLabel } from '../shared/windows.js';
import { duration, RoleIcon, Score } from './presentation.js';

type SavedAnalysis = Analysis | LegacyAnalysis;
type SavedJob = Omit<Job, 'result'> & { result?: SavedAnalysis };
const defaults: Selection = {
  encounterId: null,
  difficulty: null,
  mode: 'all',
  fightIds: null,
  excludeWipeTail: false,
};
const roles: Role[] = ['dps', 'healer', 'tank', 'unknown'];
const roleName = (role: Role) =>
  ({ dps: 'DPS', healer: 'Healers', tank: 'Tanks', unknown: 'Role not recorded' })[role];
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const currentModel = (analysis: SavedAnalysis): analysis is Analysis =>
  'model' in analysis && analysis.model?.id === 'execution/v3';
async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The service returned an unreadable response. Please retry.');
  }
  if (!response.ok)
    throw new Error(
      typeof data?.message === 'string' ? data.message : 'This request could not be completed.',
    );
  return data as T;
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
    const dialog = ref.current!,
      previous = document.activeElement as HTMLElement | null;
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
      className={`modal${wide ? ' wide' : ''}`}
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
function LegacyResults({ analysis }: { analysis: LegacyAnalysis }) {
  return (
    <section className="panel legacy-results" aria-label="Previous model results">
      <h3>Saved results</h3>
      <p className="muted">
        These scores belong to the previous model. Update this analysis to use the simplified score.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Previous score</th>
              <th>Pulls</th>
            </tr>
          </thead>
          <tbody>
            {analysis.players.map((p) => (
              <tr key={`${p.id}:${p.role}`}>
                <td>
                  {p.name}
                  <small>
                    {p.spec} {p.class}
                  </small>
                </td>
                <td>{scoreLabel(p.score, p.provisional)}</td>
                <td>{p.pulls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export default function App() {
  const [status, setStatus] = useState<Status | null>(null),
    [url, setUrl] = useState(''),
    [report, setReport] = useState<Report | null>(null),
    [selection, setSelection] = useState<Selection>(defaults);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [job, setJob] = useState<SavedJob | null>(null),
    [analysis, setAnalysis] = useState<SavedAnalysis | null>(null);
  const [pollPaused, setPollPaused] = useState(false),
    [pollRetry, setPollRetry] = useState(0),
    [share, setShare] = useState(false),
    [player, setPlayer] = useState<RankedPlayer | null>(null),
    [method, setMethod] = useState(false),
    [pullPicker, setPullPicker] = useState(false),
    [query, setQuery] = useState(''),
    [role, setRole] = useState('all');
  const request = useRef<AbortController | null>(null),
    resultRef = useRef<HTMLElement>(null);
  function applyJob(next: SavedJob) {
    setJob(next);
    if (next.status === 'complete' && next.result) {
      setReport(next.result.report);
      setSelection(next.result.selection);
      setUrl(next.demo ? '' : `https://www.warcraftlogs.com/reports/${next.reportCode}`);
      setAnalysis(next.result);
      setBusy(false);
      setTimeout(
        () => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        100,
      );
    } else if (next.status === 'failed') {
      setBusy(false);
      setError(next.error ?? 'Analysis failed.');
    } else if (next.status === 'complete') {
      setBusy(false);
      setError('This saved analysis has no result. Please start a new analysis.');
    }
  }
  function clearAnalysisLocation() {
    if (new URLSearchParams(window.location.search).has('analysis'))
      window.history.pushState(null, '', '/');
    setShare(false);
  }
  useEffect(() => {
    async function restore() {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setAnalysis(null);
      setJob(null);
      setReport(null);
      setBusy(false);
      setError('');
      setPlayer(null);
      setMethod(false);
      setShare(false);
      setQuery('');
      setRole('all');
      setPullPicker(false);
      setPollPaused(false);
      setSelection(defaults);
      setUrl('');
      try {
        const id = sharedAnalysisId(window.location.search);
        if (!id) return;
        setBusy(true);
        const next = await api<SavedJob>(`/api/analyses/${id}`, undefined, controller.signal);
        if (!controller.signal.aborted) applyJob(next);
      } catch (e) {
        if (!controller.signal.aborted) {
          setBusy(false);
          setError(e instanceof Error ? e.message : 'This shared analysis could not be opened.');
        }
      }
    }
    void restore();
    window.addEventListener('popstate', restore);
    return () => {
      window.removeEventListener('popstate', restore);
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    api<Status>('/api/status')
      .then(setStatus)
      .catch(() => setError('The analysis service is unavailable. Please try again shortly.'));
    return () => request.current?.abort();
  }, []);
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return;
    const controller = new AbortController();
    let failures = 0,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<SavedJob>(`/api/analyses/${job.id}`, undefined, controller.signal);
        if (controller.signal.aborted) return;
        failures = 0;
        applyJob(next);
        if (['queued', 'running'].includes(next.status)) timer = setTimeout(poll, 1200);
      } catch {
        if (!controller.signal.aborted) {
          if (++failures <= 3) timer = setTimeout(poll, 1000 * 2 ** (failures - 1));
          else setPollPaused(true);
        }
      }
    };
    timer = setTimeout(poll, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [job?.id, job?.status, pollRetry]);
  const chosen = useMemo(
    () => (report ? selectFights(report, selection) : []),
    [report, selection],
  );
  const bosses = useMemo(
    () => (report ? [...new Map(report.fights.map((f) => [f.encounterId, f.name])).entries()] : []),
    [report],
  );
  const fresh = analysis && currentModel(analysis) ? analysis : null;
  const shown =
    fresh?.players
      .filter(
        (p) =>
          (role === 'all' || p.role === role) && p.name.toLowerCase().includes(query.toLowerCase()),
      )
      .sort(
        (a, b) =>
          roles.indexOf(a.role) - roles.indexOf(b.role) ||
          Number(!!a.rankingReason) - Number(!!b.rankingReason) ||
          (b.score ?? -1) - (a.score ?? -1) ||
          a.name.localeCompare(b.name),
      ) ?? [];
  const change = (patch: Partial<Selection>) => {
    clearAnalysisLocation();
    setSelection((s) => ({ ...s, ...patch }));
    setAnalysis(null);
    setJob(null);
    setPlayer(null);
    setMethod(false);
    setPollPaused(false);
  };
  async function load(demo = false) {
    if (busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    clearAnalysisLocation();
    setBusy(true);
    setError('');
    setAnalysis(null);
    setJob(null);
    setReport(null);
    setPlayer(null);
    setMethod(false);
    setQuery('');
    setRole('all');
    setPullPicker(false);
    try {
      const next = demo
        ? await api<Report>('/api/demo/report', undefined, controller.signal)
        : await api<Report>('/api/reports/inspect', { url }, controller.signal);
      if (!controller.signal.aborted) {
        setReport(next);
        setSelection(defaults);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Report could not be loaded.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function start() {
    if (!report || busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setAnalysis(null);
    setJob(null);
    setPlayer(null);
    setMethod(false);
    setPollPaused(false);
    const { wipeStops: _legacyStops, ...automatic } = selection;
    const frozen = { ...automatic, excludeWipeTail: false, fightIds: chosen.map((f) => f.id) };
    try {
      const created = await api<{ id: string; status: Job['status'] }>(
        '/api/analyses',
        { reportCode: report.code, demo: report.source === 'demo', selection: frozen },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      window.history.pushState(null, '', analysisLink(window.location.origin, created.id));
      setJob({
        id: created.id,
        status: created.status,
        progress: 0,
        message: 'Queued for analysis',
        createdAt: new Date().toISOString(),
        reportCode: report.code,
        selection: frozen,
        demo: report.source === 'demo',
      });
    } catch (e) {
      if (!controller.signal.aborted) {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'Analysis could not start.');
      }
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
            <i /> {VERSION}
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
        <section className={`hero${report ? ' loaded' : ''}`}>
          <p className="eyebrow">
            <span className="line" /> EVERY PULL COUNTS
          </p>
          <h1>
            {report ? (
              'Your raid, clearly.'
            ) : (
              <>
                Every pull.
                <br />
                <em>The whole picture.</em>
              </>
            )}
          </h1>
          {!report && <p className="lead">Clear rankings. Measurable mechanics. Time alive.</p>}
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
            <span>Public reports · Wipes & kills</span>
            <button className="text-button" onClick={() => void load(true)} disabled={busy}>
              Explore the synthetic demo <ArrowRight size={13} />
            </button>
          </div>
          {status && !status.liveConfigured && (
            <p className="setup-state">
              Live imports await server-side credentials. The labelled synthetic demo is available.
            </p>
          )}
        </section>
        {!report && !busy && <RecentAnalyses />}
        {error && (
          <div className="notice error" role="alert">
            <CircleHelp size={19} />
            <div>
              <strong>Unable to continue</strong>
              <p>{error}</p>
              {new URLSearchParams(window.location.search).has('analysis') && (
                <a href="/" className="text-button">
                  Start a new analysis
                </a>
              )}
            </div>
            <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={17} />
            </button>
          </div>
        )}
        {busy && !job && !report && new URLSearchParams(window.location.search).has('analysis') && (
          <div className="notice" role="status">
            <LoaderCircle size={18} className="spin" /> Opening shared analysis…
          </div>
        )}
        {report && (
          <section className="panel selection-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  {report.source === 'demo' ? 'SYNTHETIC DEMO' : report.zone}
                </p>
                <h2>{report.title}</h2>
              </div>
              <span className="tag">
                {report.source === 'demo' ? 'NOT REAL LOGS' : `${report.fights.length} pulls`}
              </span>
            </div>
            {report.source === 'demo' && (
              <p className="demo-label">
                All players, mechanics and scores in this session are synthetic.
              </p>
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
                {selection.fightIds ? 'Custom selection' : 'Select pulls'} <ChevronDown size={14} />
              </button>
              <span className="muted">
                {chosen.length} pulls ·{' '}
                {duration(chosen.reduce((n, f) => n + f.endTime - f.startTime, 0))}
              </span>
              <button
                className="primary analyze"
                onClick={() => void start()}
                disabled={busy || !chosen.length}
              >
                {busy && job ? (
                  <>
                    <LoaderCircle size={16} className="spin" /> Analyzing
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
                  <strong>Select individual pulls</strong>
                  <div className="inline-actions">
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
                </div>
                <p className="small muted">
                  Kills and wipes are assessed automatically. No manual stop times are needed.
                </p>
                {selectFights(report, { ...selection, fightIds: null }).map((f) => (
                  <div className="pull-config" key={f.id}>
                    <label>
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
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        {busy && job && (
          <section className="panel progress-panel" role="status">
            <div>
              <LoaderCircle size={20} className="spin" />
              <strong>{job.message}</strong>
              <span>{job.progress}%</span>
            </div>
            <progress value={job.progress} max={100} />
            {pollPaused && (
              <div className="notice error" role="alert">
                <div>
                  <strong>Status check interrupted</strong>
                  <p>The analysis may still be running.</p>
                  <button
                    className="secondary"
                    onClick={() => {
                      setPollPaused(false);
                      setPollRetry((n) => n + 1);
                    }}
                  >
                    Resume status check
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
        {analysis && (
          <section ref={resultRef} className="results">
            {!fresh && (
              <div className="notice legacy-notice">
                <div>
                  <strong>Saved with the earlier scoring model</strong>
                  <p>This snapshot is unchanged. Update it to use mechanics and time alive.</p>
                  <button className="primary" disabled={busy} onClick={() => void start()}>
                    Update analysis
                  </button>
                </div>
              </div>
            )}
            <div className="section-heading result-heading">
              <div>
                <h2>Raid performance</h2>
                <p className="muted">
                  {analysis.summary.pulls} pulls · {analysis.summary.kills} kills ·{' '}
                  {analysis.summary.bosses} bosses · {analysis.summary.players} players
                </p>
              </div>
              <div className="result-actions">
                {job?.status === 'complete' && (
                  <button className="secondary" onClick={() => setShare(true)}>
                    <Share2 size={15} /> Share analysis
                  </button>
                )}
                {fresh && (
                  <button className="text-button" onClick={() => setMethod(true)}>
                    <CircleHelp size={16} /> How calculated
                  </button>
                )}
              </div>
            </div>
            {fresh ? (
              <section className="panel ranking" aria-label="Separate role rankings">
                <div className="section-heading">
                  <div>
                    <h3>Player standings</h3>
                    <p className="ranking-caption">
                      Automatic kill & wipe scoring · measured mechanics and survival
                    </p>
                  </div>
                  <div className="table-controls">
                    <label className="search">
                      <Search size={15} />
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
                      <option value="dps">DPS</option>
                      <option value="healer">Healers</option>
                      <option value="tank">Tanks</option>
                      <option value="unknown">Role not recorded</option>
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
                        <th className="detail-column">Alive</th>
                        <th className="detail-column">Output / sec</th>
                        <th className="detail-column">Pulls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p, index) => (
                        <Fragment key={p.rowKey}>
                          {(index === 0 || shown[index - 1].role !== p.role) && (
                            <tr className="role-group">
                              <th colSpan={7}>
                                <RoleIcon role={p.role} />
                                {roleName(p.role)}
                                <small>Rank within the same complete role selection</small>
                              </th>
                            </tr>
                          )}
                          <tr onClick={() => setPlayer(p)}>
                            <td className="rank">{p.roleRank ?? '—'}</td>
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
                                    {p.spec} {p.class}
                                    <span className="mobile-pulls"> · {p.pulls} pulls</span>
                                    {p.rankingReason && p.score !== null && (
                                      <span className="cell-sub">Partial selection · unranked</span>
                                    )}
                                  </small>
                                </span>
                              </button>
                            </td>
                            <td>
                              <Score value={p.score} />
                              {p.execution?.scoreBasis === 'survival-only' && (
                                <small className="cell-sub">Survival only</small>
                              )}
                            </td>
                            <td className="mechanic-cell">
                              {p.execution.checkedMechanics ? (
                                <>
                                  <strong>
                                    {p.execution.passedChecks} / {p.execution.checkedMechanics}
                                  </strong>
                                  <small
                                    className={p.execution.failedChecks ? 'failed-text' : 'muted'}
                                  >
                                    {p.execution.failedChecks || p.execution.missedWhileDead
                                      ? `${p.execution.failedChecks} failed`
                                      : 'passed'}
                                    {(p.execution.missedWhileDead ?? 0) > 0 &&
                                      ` · ${p.execution.missedWhileDead} dead`}
                                  </small>
                                </>
                              ) : (
                                <span className="muted">
                                  {p.execution.scoreBasis === 'no-contribution'
                                    ? 'No actions'
                                    : 'Survival only'}
                                </span>
                              )}
                            </td>
                            <td className="detail-column">
                              {p.execution.alivePercent.toFixed(1)}%
                            </td>
                            <td className="detail-column">
                              {compact.format(
                                (p.role === 'healer' ? p.healing : p.damage) /
                                  Math.max(1, p.durationMs / 1000),
                              )}
                              <small className="cell-sub">
                                {p.role === 'healer' ? 'HPS' : 'DPS'} · raw
                              </small>
                            </td>
                            <td className="detail-column">
                              {p.scoredPulls} / {p.pulls}
                              <small className="cell-sub">scored</small>
                            </td>
                          </tr>
                        </Fragment>
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
                </div>
              </section>
            ) : (
              <LegacyResults analysis={analysis as LegacyAnalysis} />
            )}
            <details className="session-details">
              <summary>
                Selected pulls <span>{analysis.pulls.length}</span>
              </summary>
              <div className="pull-table">
                {analysis.pulls.map((p) => (
                  <div key={p.fight.id}>
                    <span>#{p.fight.id}</span>
                    <span>
                      {p.fight.name}
                      <small>{difficultyName(p.fight.difficulty)}</small>
                    </span>
                    <span>{duration(p.fight.endTime - p.fight.startTime)}</span>
                    <span className={p.fight.kill ? 'kill' : 'muted'}>
                      {p.fight.kill ? 'Kill' : 'Wipe'}
                      {p.window && (
                        <small>
                          {windowLabel(p.window)} · {duration(p.window.endTime - p.fight.startTime)}
                        </small>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </section>
        )}
        <footer>
          <span>
            DARKWHISPERS <small>Independent community project</small>
          </span>
          <a
            href="https://github.com/akiondev/darkwhispers/tree/main/app"
            target="_blank"
            rel="noreferrer"
          >
            Source & methodology <ExternalLink size={12} />
          </a>
        </footer>
      </main>
      {share && job && analysis && (
        <Modal title="Share analysis" onClose={() => setShare(false)}>
          <ShareLink job={job} />
        </Modal>
      )}
      {player && fresh && (
        <Modal title="Player analysis" onClose={() => setPlayer(null)} wide>
          <CompactPlayerDetails key={player.rowKey} player={player} analysis={fresh} />
        </Modal>
      )}
      {method && fresh && (
        <Modal title="How scoring works" onClose={() => setMethod(false)}>
          <div className="method-simple">
            <p>
              <strong>Automatic scores for kills and wipes</strong>
            </p>
            <p>
              When measured, the base is <b>mechanics × time alive / 100</b>. If shared mechanics
              cannot be measured, the pull uses a labelled survival-only base. No mechanic success
              is invented.
            </p>
            <p>
              Each reviewed mechanic family has an equal budget. Applicable checks remain uncredited
              while dead. Kills and recorded wipe-call windows deduct five points per death,
              retained after resurrection. Unmarked wipes have no extra flat death deduction.
            </p>
            <p>
              A recorded wipe call is used automatically. Otherwise a common terminal-collapse
              policy selects the assessment end. This is an estimate, not knowledge of a voice call.
              Every completed pull contributes without manual setup.
            </p>
            <p>
              Pull scores are weighted by assessed duration within each boss/difficulty, then bosses
              and difficulty contexts have equal weight. Ordinal ranks require the same complete
              role selection. DPS, healers and tanks stay separate; partial attendance is labelled.
            </p>
            <p>
              Raw DPS/HPS, intake, preparation and items carry no score weight. Execution score is
              not a complete class-skill or AFK assessment. No recorded contribution earns zero
              credit.
            </p>
            <details>
              <summary>Data & references</summary>
              {fresh.methodology.limitations.map((l) => (
                <p key={l}>{l}</p>
              ))}
              {fresh.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              <a
                href="https://github.com/akiondev/darkwhispers/tree/main/app/docs"
                target="_blank"
                rel="noreferrer"
              >
                Methodology and rule sources <ExternalLink size={13} />
              </a>
              <p className="small muted">
                Engine {fresh.version} · {fresh.model.id}
              </p>
            </details>
          </div>
        </Modal>
      )}
    </>
  );
}
