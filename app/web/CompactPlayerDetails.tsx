import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import type { Analysis, ExecutionMechanic, RankedPlayer } from '../shared/types.js';
import { difficultyName } from '../shared/report-url.js';
import { duration, RoleIcon, Score } from './presentation.js';
import { windowLabel } from '../shared/windows.js';
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const output = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export default function CompactPlayerDetails({
  player,
  analysis,
}: {
  player: RankedPlayer;
  analysis: Analysis;
}) {
  const [pullId, setPullId] = useState('all'),
    [eventLimit, setEventLimit] = useState(15);
  const reviews = player.pullReviews;
  const selected = reviews.find((r) => String(r.fightId) === pullId);
  const rows = selected ? [selected] : reviews;
  const assessment = selected?.execution ?? player.execution;
  const totals = rows.reduce(
    (n, r) => ({
      duration: n.duration + r.durationMs,
      alive: n.alive + r.aliveMs,
      deaths: n.deaths + r.deaths,
      damage: n.damage + r.damage,
      healing: n.healing + r.healing,
      taken: n.taken + r.damageTaken,
      casts: n.casts + r.facts.casts,
    }),
    { duration: 0, alive: 0, deaths: 0, damage: 0, healing: 0, taken: 0, casts: 0 },
  );
  const snapshots = rows.filter((r) => r.facts.snapshot);
  const atPull = (category: 'flask' | 'food' | 'combat-potion') =>
    snapshots.length
      ? `${snapshots.filter((r) => r.facts.activeAtPull.some((a) => a.category === category)).length} / ${snapshots.length} starts`
      : 'Not recorded';
  const consumables = rows.flatMap((r) => r.facts.consumables);
  const uses = (kind: 'healthstone' | 'healing-potion' | 'combat-potion') =>
    consumables.filter((c) => c.kind === kind).reduce((n, c) => n + c.uses, 0);
  const enchants = snapshots
    .filter((r) => r.facts.enchantsObserved !== undefined)
    .map((r) => r.facts.enchantsObserved!.length);
  const enchantLabel = !enchants.length
    ? 'Not recorded'
    : selected
      ? `${enchants[0]} slots recorded`
      : Math.min(...enchants) === Math.max(...enchants)
        ? `${enchants[0]} slots per recorded pull`
        : `${Math.min(...enchants)}–${Math.max(...enchants)} slots per recorded pull`;
  const gems = snapshots
    .filter((r) => r.facts.gemsObserved !== undefined)
    .map((r) => r.facts.gemsObserved!.length);
  const gemLabel =
    !gems.length || !gems.some((count) => count > 0)
      ? 'Not recorded'
      : selected
        ? `${gems[0]} gems recorded`
        : Math.min(...gems) === Math.max(...gems)
          ? `${gems[0]} gems per recorded pull`
          : `${Math.min(...gems)}–${Math.max(...gems)} gems per recorded pull`;
  const mechanics = useMemo(() => {
    const grouped = new Map<string, ExecutionMechanic>();
    for (const r of rows)
      for (const m of r.mechanics) {
        if (!m.observed && !m.opportunities) continue;
        const prior = grouped.get(m.ruleId);
        if (!prior)
          grouped.set(m.ruleId, {
            ...m,
            passed: m.scored ? m.passed : 0,
            failed: m.scored ? m.failed : 0,
            opportunities: m.scored ? m.opportunities : 0,
            events: [...m.events],
            breakdown: m.breakdown ? [...m.breakdown] : undefined,
          });
        else {
          prior.passed += m.scored ? m.passed : 0;
          prior.failed += m.scored ? m.failed : 0;
          prior.missedWhileDead =
            (prior.missedWhileDead ?? 0) + (m.scored ? (m.missedWhileDead ?? 0) : 0);
          prior.opportunities += m.scored ? m.opportunities : 0;
          prior.observed += m.observed;
          prior.scored ||= m.scored;
        }
      }
    return [...grouped.values()].sort(
      (a, b) =>
        Number(b.scored) - Number(a.scored) || b.failed - a.failed || a.name.localeCompare(b.name),
    );
  }, [pullId, player]);
  const evidence = player.evidence.filter(
    (e) =>
      (pullId === 'all' || String(e.fightId) === pullId) &&
      ['mechanic', 'death', 'interrupt', 'dispel'].includes(e.kind),
  );
  const life = rows
    .flatMap((r) => r.facts.lifeEvents.map((e) => ({ ...e, fightId: r.fightId })))
    .sort((a, b) => a.timestamp - b.timestamp);
  const active = reviews.findIndex((r) => String(r.fightId) === pullId);
  const select = (value: string) => {
    setPullId(value);
    setEventLimit(15);
  };
  return (
    <>
      <div className="player-hero">
        <RoleIcon role={player.role} />
        <div>
          <p className="eyebrow">
            {player.spec} {player.class} ·{' '}
            {player.role === 'unknown'
              ? 'role not recorded'
              : player.role === 'dps'
                ? 'DPS'
                : player.role}
          </p>
          <h3>{player.name}</h3>
        </div>
        <Score value={assessment.score} />
      </div>
      <ul className="score-reasons" aria-label="Score explanation">
        {assessment.reasons.slice(0, 2).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      {player.rankingReason && player.score !== null && (
        <p className="small muted">{player.rankingReason}</p>
      )}
      <section className="compact-player-pulls" aria-label="Player review by pull">
        <div className="pull-navigation">
          <button
            className="icon-button"
            aria-label="Previous player pull"
            disabled={active < 0}
            onClick={() => select(active === 0 ? 'all' : String(reviews[active - 1].fightId))}
          >
            <ChevronLeft size={18} />
          </button>
          <label className="sr-only" htmlFor="player-pull">
            Player pull
          </label>
          <select id="player-pull" value={pullId} onChange={(e) => select(e.target.value)}>
            <option value="all">All attended pulls · {player.pulls}</option>
            {reviews.map((r) => {
              const f = analysis.pulls.find((p) => p.fight.id === r.fightId)!.fight;
              return (
                <option key={f.id} value={f.id}>
                  Pull {f.id} · {f.name} · {difficultyName(f.difficulty)} ·{' '}
                  {f.kill ? 'Kill' : 'Wipe'}
                </option>
              );
            })}
          </select>
          <button
            className="icon-button"
            aria-label="Next player pull"
            disabled={active === reviews.length - 1 || !reviews.length}
            onClick={() => select(String(reviews[active + 1].fightId))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        {selected?.window && (
          <p className="window-caption">
            {windowLabel(selected.window)} · assessment {duration(selected.durationMs)}
            {!selected.window.confirmed && ' · statistics only'}
          </p>
        )}
        <div className="execution-stats">
          <div>
            <span>Mechanics</span>
            <strong>
              {assessment.passedChecks} / {assessment.checkedMechanics}
            </strong>
            <small className={assessment.failedChecks ? 'failed-text' : ''}>
              {assessment.failedChecks} failed · {assessment.missedWhileDead ?? 0} not credited
              while dead
            </small>
          </div>
          <div>
            <span>Time alive</span>
            <strong>{assessment.alivePercent.toFixed(1)}%</strong>
            <small>{selected ? 'This pull' : 'Scoring average'}</small>
          </div>
          <div>
            <span>Time dead</span>
            <strong>{duration(Math.max(0, totals.duration - totals.alive))}</strong>
            <small>
              {totals.deaths} {totals.deaths === 1 ? 'death' : 'deaths'}
            </small>
          </div>
        </div>
        <div className="raw-summary">
          <span>
            <b>
              {output.format(
                (player.role === 'healer' ? totals.healing : totals.damage) /
                  Math.max(1, totals.duration / 1000),
              )}
            </b>{' '}
            {player.role === 'healer' ? 'HPS' : 'DPS'}
          </span>
          <span>
            <b>{output.format(totals.taken)}</b> damage taken
          </span>
          <span>
            <b>{totals.casts}</b> recorded casts
          </span>
        </div>
        <div className="preparation-summary">
          <h4>
            Preparation & item usage{' '}
            <span>
              Statistics · {snapshots.length}/{rows.length} start snapshots
            </span>
          </h4>
          <dl>
            <div>
              <dt>Flask at pull</dt>
              <dd>{atPull('flask')}</dd>
            </div>
            <div>
              <dt>Food at pull</dt>
              <dd>{atPull('food')}</dd>
            </div>
            <div>
              <dt>Potion active at pull</dt>
              <dd>{atPull('combat-potion')}</dd>
            </div>
            <div>
              <dt>Healthstone uses</dt>
              <dd>{uses('healthstone')}</dd>
            </div>
            <div>
              <dt>Healing potion uses</dt>
              <dd>{uses('healing-potion')}</dd>
            </div>
            <div>
              <dt>Combat potion uses</dt>
              <dd>{uses('combat-potion')}</dd>
            </div>
            <div>
              <dt>Observed enchants</dt>
              <dd>{enchantLabel}</dd>
            </div>
            <div>
              <dt>Observed gems</dt>
              <dd>{gemLabel}</dd>
            </div>
          </dl>
        </div>
        <details className="calculation-evidence">
          <summary>
            Calculation & evidence <ChevronRight size={16} />
          </summary>
          <div className="formula-line">
            <span>
              {selected ? 'Mechanics' : 'Mechanics average'}{' '}
              <b>
                {assessment.mechanicsScore === null ? '—' : assessment.mechanicsScore.toFixed(1)}
              </b>{' '}
              {selected && '×'}
            </span>
            <span>
              Time alive <b>{assessment.alivePercent.toFixed(1)}%</b> {selected && '/ 100'}
            </span>
            <span>
              {selected ? 'Base' : 'Base average'}{' '}
              <b>{assessment.baseScore === null ? '—' : assessment.baseScore.toFixed(1)}</b>
            </span>
            <span>
              {selected ? 'Death deduction' : 'Weighted death deduction'}{' '}
              <b>−{(assessment.deathPenalty ?? 0).toFixed(1)}</b>
            </span>
          </div>
          <p className="small muted">
            Each recorded assessed death deducts five points before averaging. Battle resurrection
            does not erase it. {assessment.scoredPulls} of {assessment.totalPulls} attended pulls
            have comparable checks. Raw output, preparation and consumables carry no score weight.
          </p>
          {!selected && (
            <p className="small muted">
              Pull scores use assessed duration weights within each boss/difficulty. Bosses and
              difficulty contexts then have equal weight. These average inputs do not directly
              reproduce the final score. Raw statistics also include unscored pulls.
            </p>
          )}
          {!selected && (
            <div className="boss-summary-list">
              {player.perBoss.map((b) => (
                <div key={`${b.encounterId}:${b.difficulty}`}>
                  <span>
                    {b.name}
                    <small>
                      {difficultyName(b.difficulty)} · {b.execution.scoredPulls} / {b.pulls} scored
                      pulls
                    </small>
                  </span>
                  <Score value={b.score} />
                </div>
              ))}
            </div>
          )}
          {mechanics.length > 0 && (
            <div className="mechanic-summary-list">
              <h4>Tracked mechanics</h4>
              {mechanics.map((m) => (
                <div key={m.ruleId}>
                  <span>
                    {m.scored && <CheckCircle2 size={14} />}
                    <b>{m.name}</b>
                    <small>
                      {m.scored
                        ? `${m.passed} passed · ${m.failed} failed · ${m.missedWhileDead ?? 0} not credited while dead · ${m.opportunities} checks`
                        : `Observed only · ${m.observed} records`}
                    </small>
                    {m.scored && <small>{m.detail}</small>}
                    {!m.scored && m.exclusion && <small>{m.exclusion}</small>}
                  </span>
                  <a
                    href={m.source}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${m.name} encounter reference`}
                  >
                    <ExternalLink size={15} />
                  </a>
                </div>
              ))}
            </div>
          )}
          {life.length > 0 && (
            <div className="life-summary">
              <h4>Deaths & returns</h4>
              {life.slice(0, 12).map((e, i) => {
                const f = analysis.pulls.find((p) => p.fight.id === e.fightId)!.fight;
                return (
                  <p key={i}>
                    <span>
                      Pull {e.fightId} · {duration(e.timestamp - f.startTime)}
                    </span>
                    {e.type === 'death'
                      ? 'Died'
                      : e.combatRes
                        ? `Combat resurrection${e.abilityName ? ` · ${e.abilityName}` : ''}`
                        : 'Recorded resurrection'}
                  </p>
                );
              })}
              {life.length > 12 && (
                <small>{life.length - 12} more life events in the WCL timeline.</small>
              )}
            </div>
          )}
          <div className="event-list">
            {evidence.slice(0, eventLimit).map((e, index) => {
              const f = analysis.pulls.find((p) => p.fight.id === e.fightId)!.fight;
              return (
                <article className="event" key={`${e.fightId}:${e.timestamp}:${index}`}>
                  <div>
                    <time>
                      #{e.fightId} · {duration(e.timestamp - f.startTime)}
                    </time>
                    <strong>{e.ability}</strong>
                  </div>
                  <p>{e.description}</p>
                  {e.amount !== undefined && (
                    <small>{number.format(e.amount)} recorded damage</small>
                  )}
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noreferrer">
                      View in Warcraft Logs <ExternalLink size={12} />
                    </a>
                  )}
                </article>
              );
            })}
          </div>
          {evidence.length > eventLimit && (
            <button className="secondary" onClick={() => setEventLimit((n) => n + 20)}>
              Show more events ({evidence.length - eventLimit} remaining)
            </button>
          )}
          {!evidence.length && (
            <p className="small muted">No individual scoring or death events in this selection.</p>
          )}
        </details>
      </section>
    </>
  );
}
