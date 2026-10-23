import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Eye,
  ChevronLeft,
  ChevronRight,
  Shield,
  Heart,
  Swords,
  ExternalLink,
} from 'lucide-react';
import type { Analysis, RankedPlayer, Role } from '../shared/types.js';
import { difficultyName } from '../shared/report-url.js';
import { scoreBand, scoreLabel } from '../shared/score.js';
import { RoleFactors } from './RoleAssessment.js';
const clock = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export function RoleIcon({ role }: { role: Role }) {
  const Icon =
    role === 'tank' ? Shield : role === 'healer' ? Heart : role === 'dps' ? Swords : CircleHelp;
  return <Icon size={18} aria-hidden="true" className={`role-icon role-${role}`} />;
}
export default function PullReviews({
  player,
  analysis,
}: {
  player: RankedPlayer;
  analysis: Analysis;
}) {
  const rows = player.pullReviews ?? [];
  const [index, setIndex] = useState(
    Math.max(
      0,
      rows.findIndex((r) => r.mechanics.some((m) => m.failures > 0)),
    ),
  );
  const [showCatalogue, setShowCatalogue] = useState(false);
  if (!rows.length) return null;
  const row = rows[Math.min(index, rows.length - 1)],
    fight = analysis.pulls.find((p) => p.fight.id === row.fightId)!.fight;
  const active = row.mechanics
    .map((m) => ({ ...analysis.mechanicCatalogue?.[m.ruleId], ...m }))
    .filter((m) => showCatalogue || m.observed || m.opportunities || m.unknown);
  const ordered = [...active].sort(
    (a, b) =>
      b.failures - a.failures ||
      Number((b.weight ?? 0) > 0) - Number((a.weight ?? 0) > 0) ||
      (a.name ?? a.ruleId).localeCompare(b.name ?? b.ruleId),
  );
  return (
    <section className="pull-review" aria-label="Player review by pull">
      <h3>Every pull, explained</h3>
      <div className="pull-navigation">
        <button
          className="icon-button"
          aria-label="Previous player pull"
          disabled={index === 0}
          onClick={() => setIndex((i) => i - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <label className="sr-only" htmlFor="player-pull">
          Player pull
        </label>
        <select id="player-pull" value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {rows.map((r, i) => {
            const f = analysis.pulls.find((p) => p.fight.id === r.fightId)!.fight;
            return (
              <option key={r.fightId} value={i}>
                Pull {f.id} · {f.name} · {difficultyName(f.difficulty)} · {f.kill ? 'Kill' : 'Wipe'}
              </option>
            );
          })}
        </select>
        <button
          className="icon-button"
          aria-label="Next player pull"
          disabled={index === rows.length - 1}
          onClick={() => setIndex((i) => i + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="pull-review-heading">
        <span>
          <RoleIcon role={row.role} /> {row.role} · {clock(row.durationMs)} scored ·{' '}
          {((100 * row.aliveMs) / Math.max(1, row.durationMs)).toFixed(1)}% alive
        </span>
        <strong className={`score ${scoreBand(row.assessment.score, true)}`}>
          {scoreLabel(row.assessment.score, true)}
        </strong>
      </div>
      <p>{row.summary}</p>
      <p className="small muted">
        Per-pull score uses the same factors and sample caps. The overall score combines
        boss/difficulty contexts, so it is not the simple average of these pull scores. Raw
        damage/healing totals cover the full pull.
      </p>
      <div className="pull-review-totals">
        <span>
          Damage <b>{Math.round(row.damage).toLocaleString('en')}</b>
        </span>
        <span>
          Healing <b>{Math.round(row.healing).toLocaleString('en')}</b>
        </span>
        <span>
          Deaths <b>{row.deaths}</b>
        </span>
      </div>
      <details className="tank-method">
        <summary>Calculation for this pull</summary>
        <RoleFactors assessment={row.assessment} compact />
      </details>
      <div className="mechanic-heading">
        <h4>Mechanic checks & responsibilities</h4>
        <label>
          <input
            type="checkbox"
            checked={showCatalogue}
            onChange={(e) => setShowCatalogue(e.target.checked)}
          />{' '}
          Include unobserved rules
        </label>
      </div>
      {ordered.map((m) => (
        <details
          className={`mechanic-check ${m.failures ? 'failed' : m.opportunities ? 'measured' : 'context'}`}
          key={m.ruleId}
        >
          <summary>
            {m.failures ? (
              <AlertTriangle size={17} />
            ) : m.opportunities ? (
              <CheckCircle2 size={17} />
            ) : m.unknown ? (
              <CircleHelp size={17} />
            ) : (
              <Eye size={17} />
            )}
            <strong>{m.name}</strong>
            <span>
              {m.opportunities
                ? `${m.failures} failed / ${m.opportunities} checked`
                : m.kind === 'unmapped'
                  ? 'Unclassified'
                  : m.observed
                    ? 'Context only'
                    : 'Not observed'}
              {m.unknown ? ` · ${m.unknown} unknown` : ''}
            </span>
          </summary>
          <p>{m.detail}</p>
          <p className="small muted">
            {m.observed} timeline records ·{' '}
            {m.weight ? `${m.weight}× mechanic severity budget` : 'No personal score penalty'} ·
            rule {m.ruleId}
          </p>
          {!!m.breakdown?.length && (
            <div className="table-scroll">
              <table className="mechanic-breakdown">
                <thead>
                  <tr>
                    <th>Spell · this player</th>
                    <th>Damage</th>
                    <th>Hits</th>
                    <th>Applications</th>
                    <th>Casts</th>
                    <th>Utility</th>
                  </tr>
                </thead>
                <tbody>
                  {m.breakdown.map((b) => (
                    <tr key={b.abilityId}>
                      <td>
                        {b.name}
                        <small>#{b.abilityId}</small>
                      </td>
                      <td>{Math.round(b.damage).toLocaleString('en')}</td>
                      <td>{b.hits}</td>
                      <td>{b.applications}</td>
                      <td>{b.casts}</td>
                      <td>{b.utility}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {m.events.map((e, i) => (
            <div className={`mechanic-event outcome-${e.outcome}`} key={i}>
              <time>{clock(e.timestamp - fight.startTime)}</time>
              <span>
                <b>{e.outcome}</b> · {e.detail || m.detail}
              </span>
              {e.url && (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${m.name} at ${clock(e.timestamp - fight.startTime)} in Warcraft Logs`}
                >
                  <ExternalLink size={15} />
                </a>
              )}
            </div>
          ))}
          {m.events.length === 12 && (
            <p className="small muted">
              Showing the first 12 event links. Counters include every recorded incident.
            </p>
          )}
          <a className="small" href={m.source} target="_blank" rel="noreferrer">
            Encounter reference <ExternalLink size={12} />
          </a>
        </details>
      ))}
      {!ordered.length && (
        <p className="muted">
          No mechanic evidence is available for this pull. Missing data is not a perfect grade.
        </p>
      )}
    </section>
  );
}
