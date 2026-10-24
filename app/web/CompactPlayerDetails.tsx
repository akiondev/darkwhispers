import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Skull } from 'lucide-react';
import type { Analysis, RankedPlayer } from '../shared/types.js';
import { characterLinks } from '../shared/profile-links.js';
import { difficultyName, evidenceUrl } from '../shared/report-url.js';
import { duration, RoleIcon } from './presentation.js';
import { CompositeScore, ScoreBreakdown } from './CompositeScore.js';
import { attendanceLabel, lifeComplete, pullAttendance } from './attendance.js';

const output = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const numeric = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const roleLabel = (role: string) =>
  role === 'dps'
    ? 'DPS'
    : role === 'healer'
      ? 'Healer'
      : role === 'tank'
        ? 'Tank'
        : 'Unrecorded role';
const time = (ms: number) => (ms > 0 && ms < 1000 ? '< 1s' : duration(Math.max(0, ms)));

export default function CompactPlayerDetails({
  player,
  analysis,
  onPlayerChange,
  onCompare,
  comparing = false,
}: {
  player: RankedPlayer;
  analysis: Analysis;
  onPlayerChange: (player: RankedPlayer) => void;
  onCompare: (player: RankedPlayer) => void;
  comparing?: boolean;
}) {
  const [pullId, setPullId] = useState('all');
  const [eventLimit, setEventLimit] = useState(8);
  const reviews = player.pullReviews;
  const selected = reviews.find((r) => String(r.fightId) === pullId);
  const rows = selected ? [selected] : reviews;
  const assessment = selected?.execution ?? player.execution;
  const attendance = pullAttendance(player, analysis);
  const excluded = reviews.filter((r) => r.execution.score === null);
  const totals = rows.reduce(
    (n, r) => ({
      duration: n.duration + r.durationMs,
      alive: n.alive + r.aliveMs,
      deaths: n.deaths + r.deaths,
      firstDeaths: n.firstDeaths + (r.firstDeath ? 1 : 0),
      returns:
        n.returns +
        (r.resurrections ?? r.facts.lifeEvents.filter((e) => e.type === 'resurrect').length),
      damage: n.damage + r.damage,
      healing: n.healing + r.healing,
      taken: n.taken + r.damageTaken,
      casts: n.casts + r.facts.casts,
    }),
    {
      duration: 0,
      alive: 0,
      deaths: 0,
      firstDeaths: 0,
      returns: 0,
      damage: 0,
      healing: 0,
      taken: 0,
      casts: 0,
    },
  );
  const deadMs = Math.max(0, totals.duration - totals.alive);
  const lifeReliable = rows.every(lifeComplete);
  const verifiedLifeRows = rows.filter(lifeComplete);
  const verifiedDeadMs = verifiedLifeRows.reduce(
    (n, r) => n + Math.max(0, r.durationMs - r.aliveMs),
    0,
  );
  const profiles = characterLinks(player, analysis.report);
  const profileMessage =
    analysis.report.source === 'demo'
      ? 'Synthetic characters do not have live profiles.'
      : player.profile?.region === 'cn'
        ? 'The Armory link is not available for this region.'
        : 'Character region or realm was not supplied by this report.';
  const otherRoles = analysis.players.filter((p) => p.id === player.id);
  const active = reviews.findIndex((r) => String(r.fightId) === pullId);
  const select = (value: string) => {
    setPullId(value);
    setEventLimit(8);
  };
  const deaths = useMemo(
    () =>
      rows
        .flatMap((r) =>
          r.facts.lifeEvents
            .filter((e) => e.type === 'death')
            .map((e) => {
              const fight = analysis.pulls.find((p) => p.fight.id === r.fightId)!.fight;
              const interval = r.deadIntervals?.find((i) => i.start === e.timestamp);
              const evidence = player.evidence.find(
                (v) => v.kind === 'death' && v.fightId === r.fightId && v.timestamp === e.timestamp,
              );
              return {
                event: e,
                fight,
                deadMs: interval && lifeComplete(r) ? interval.end - interval.start : null,
                evidence,
                url:
                  evidence?.url ??
                  evidenceUrl(analysis.report, r.fightId, player.id, e.timestamp, 'deaths'),
              };
            }),
        )
        .sort((a, b) => a.event.timestamp - b.event.timestamp),
    [pullId, player, analysis],
  );
  const observations = player.evidence.filter(
    (e) => e.kind !== 'death' && (pullId === 'all' || String(e.fightId) === pullId),
  );
  const scoredMechanics = rows
    .filter((r) => r.execution.score !== null)
    .flatMap((r) => r.mechanics.filter((m) => m.scored).map((m) => ({ ...m, fightId: r.fightId })));
  const mechanicFailures = scoredMechanics
    .flatMap((m) =>
      m.events
        .filter((e) => e.outcome === 'failed')
        .map((e) => ({ ...e, fightId: m.fightId, name: m.name })),
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  const snapshots = rows.filter((r) => r.facts.snapshot);
  const atPull = (category: 'flask' | 'food' | 'combat-potion') =>
    snapshots.length
      ? `${snapshots.filter((r) => r.facts.activeAtPull.some((a) => a.category === category)).length} / ${snapshots.length} recorded starts`
      : 'Not recorded';
  const uses = (kind: 'healthstone' | 'healing-potion' | 'combat-potion') =>
    rows
      .flatMap((r) => r.facts.consumables)
      .filter((c) => c.kind === kind)
      .reduce((n, c) => n + c.uses, 0);
  const gearLabel = (kind: 'enchantsObserved' | 'gemsObserved') => {
    const counts = snapshots
      .filter((r) => r.facts[kind] !== undefined)
      .map((r) => r.facts[kind]!.length);
    return counts.length
      ? `${Math.min(...counts) === Math.max(...counts) ? counts[0] : `${Math.min(...counts)}–${Math.max(...counts)}`} per recorded pull`
      : 'Not recorded';
  };
  return (
    <>
      <div className="player-hero">
        <RoleIcon role={player.role} />
        <div>
          <p className="eyebrow">
            {player.spec} {player.class} · {roleLabel(player.role)}
          </p>
          <h3>{player.name}</h3>
        </div>
        <div className="player-score">
          <span>Score</span>
          <CompositeScore assessment={assessment} />
        </div>
      </div>
      <section className="player-attendance" aria-label="Pull coverage">
        <div>
          <strong>
            {attendance.scoredPulls}/{attendance.selectedPulls} selected pulls scored
          </strong>
          <span>{attendanceLabel(player, analysis)}</span>
          <p>
            {attendance.attendedPulls} attended as {roleLabel(player.role)}
            {attendance.otherRolePulls > 0 && ` · ${attendance.otherRolePulls} in another role`}
            {attendance.absentPulls > 0 && ` · ${attendance.absentPulls} not attended`}.
            {attendance.excludedPulls > 0 &&
              ' Excluded pulls still retain their recorded deaths and observations.'}
          </p>
        </div>
        <button
          className="secondary"
          disabled={comparing || !attendance.scoredPulls}
          onClick={() => onCompare(player)}
          title="Recalculate the same selected pulls for every player. Placements require all these pulls in the same role."
        >
          Compare same pulls
        </button>
      </section>
      {player.rankingReason && <p className="ranking-note">{player.rankingReason}</p>}
      {excluded.length > 0 && (
        <details className="excluded-pulls">
          <summary>
            {excluded.length} {excluded.length === 1 ? 'pull excluded' : 'pulls excluded'} from
            score
          </summary>
          {excluded.map((r) => {
            const fight = analysis.pulls.find((p) => p.fight.id === r.fightId)!.fight;
            const link =
              analysis.report.source === 'demo'
                ? null
                : `https://www.warcraftlogs.com/reports/${analysis.report.code}?fight=${r.fightId}&type=deaths&source=${player.id}`;
            return (
              <div key={r.fightId}>
                <button className="text-button" onClick={() => select(String(r.fightId))}>
                  Pull #{r.fightId} · {fight.name}
                </button>
                <p>
                  {r.execution.reasons.join(' ') ||
                    'The recorded data is insufficient to calculate this pull.'}
                </p>
                {link && (
                  <a className="evidence-link" href={link} target="_blank" rel="noreferrer">
                    View in Warcraft Logs <ExternalLink size={12} />
                  </a>
                )}
              </div>
            );
          })}
        </details>
      )}
      <div className="profile-links" aria-label="Character profiles">
        {(
          [
            ['Warcraft Logs', profiles.warcraftLogs],
            ['Raider.IO', profiles.raiderIO],
            ['Armory', profiles.armory],
          ] as const
        ).map(([label, href]) =>
          href ? (
            <a className="secondary" key={label} href={href} target="_blank" rel="noreferrer">
              {label}
              <ExternalLink size={12} />
            </a>
          ) : (
            <button className="secondary" key={label} disabled title={profileMessage}>
              {label}
              <ExternalLink size={12} />
            </button>
          ),
        )}
      </div>
      {(!profiles.raiderIO || !profiles.armory) && (
        <p className="profile-unavailable">{profileMessage}</p>
      )}
      {otherRoles.length > 1 && (
        <div className="role-scores" aria-label="Separate scores by role">
          <span>This character’s role scores</span>
          <div>
            {otherRoles.map((p) => (
              <button
                key={p.rowKey}
                className={p.rowKey === player.rowKey ? 'selected' : ''}
                aria-pressed={p.rowKey === player.rowKey}
                onClick={() => onPlayerChange(p)}
              >
                <RoleIcon role={p.role} />
                {roleLabel(p.role)}
                <CompositeScore assessment={p.execution} />
              </button>
            ))}
          </div>
        </div>
      )}
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
          <option value="all">
            All {reviews.length} pulls as {roleLabel(player.role)}
          </option>
          {reviews.map((r) => {
            const f = analysis.pulls.find((p) => p.fight.id === r.fightId)!.fight;
            return (
              <option key={f.id} value={f.id}>
                #{f.id} · {f.name} · {difficultyName(f.difficulty)} · {f.kill ? 'Kill' : 'Wipe'}
                {r.execution.score === null ? ' · Excluded from score' : ''}
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
      <ScoreBreakdown assessment={assessment} />
      <section className="mechanic-review" aria-label="Mechanic evidence">
        <div className="section-heading">
          <h4>Mechanics to review</h4>
          <span className="small muted">
            {assessment.passedChecks} completed · {assessment.failedChecks} failed ·{' '}
            {assessment.checkedMechanics} checks
          </span>
        </div>
        {!scoredMechanics.length ? (
          <p className="small muted">
            {assessment.score === null
              ? 'This pull cannot be scored from the available data. Recorded facts remain visible below.'
              : 'No comparable mechanic checks are scored for this selection. The score uses output and survival instead.'}
          </p>
        ) : !mechanicFailures.length ? (
          <p className="small muted">
            No recorded failures among the scored mechanic checks in this selection.
          </p>
        ) : (
          mechanicFailures.slice(0, eventLimit).map((event, i) => (
            <article className="death-event" key={`${event.fightId}:${event.timestamp}:${i}`}>
              <div>
                <strong>{event.name}</strong>
                <small>
                  Pull #{event.fightId} · {event.detail}
                </small>
              </div>
              {event.url ? (
                <a className="evidence-link" href={event.url} target="_blank" rel="noreferrer">
                  View event <ExternalLink size={13} />
                </a>
              ) : (
                <span className="small muted">Synthetic event</span>
              )}
            </article>
          ))
        )}
        {(assessment.missedWhileDead ?? 0) > 0 && (
          <p className="small muted">
            {assessment.missedWhileDead} opportunities were not completed while dead. These earn no
            completion points and are recorded separately from mechanic failures.
          </p>
        )}
        {mechanicFailures.length > eventLimit && (
          <button className="text-button" onClick={() => setEventLimit((n) => n + 12)}>
            Show {Math.min(12, mechanicFailures.length - eventLimit)} more mechanic events{' '}
            <ChevronRight size={14} />
          </button>
        )}
        {scoredMechanics.length > 0 && (
          <details className="mechanic-checks">
            <summary>Verified checks by mechanic</summary>
            {[...new Map(scoredMechanics.map((m) => [m.ruleId, m])).values()].map((m) => {
              const matches = scoredMechanics.filter((v) => v.ruleId === m.ruleId);
              return (
                <div key={m.ruleId}>
                  <span>{m.name}</span>
                  <span>
                    {matches.reduce((n, v) => n + v.passed, 0)} completed ·{' '}
                    {matches.reduce((n, v) => n + v.failed, 0)} failed
                    {matches.some((v) => (v.missedWhileDead ?? 0) > 0) &&
                      ` · ${matches.reduce((n, v) => n + (v.missedWhileDead ?? 0), 0)} not completed while dead`}
                  </span>
                </div>
              );
            })}
          </details>
        )}
      </section>
      <div className="survival-summary" aria-label="Score explanation">
        {lifeReliable ? (
          <p>
            <strong>
              {totals.deaths} {totals.deaths === 1 ? 'death' : 'deaths'}
            </strong>{' '}
            · <strong>{time(deadMs)}</strong> dead out of {time(totals.duration)} recorded in this
            role.
          </p>
        ) : (
          <p>
            <strong>
              {totals.deaths} recorded {totals.deaths === 1 ? 'death' : 'deaths'}.
            </strong>{' '}
            Total dead time is incomplete because a recorded life timeline cannot be fully
            reconstructed.
            {verifiedLifeRows.length > 0 &&
              ` ${time(verifiedDeadMs)} dead is verified across ${verifiedLifeRows.length}/${rows.length} pulls.`}
          </p>
        )}
        <p className="small muted">
          All recorded deaths through pull end remain included, including wipes. Resurrection ends
          dead time without erasing the death. These events alone do not establish wipe
          responsibility.
        </p>
      </div>
      <div className="execution-stats survival-stats">
        <div>
          <span>Time dead</span>
          <strong
            className={!lifeReliable ? 'stat-unavailable' : undefined}
            title={
              lifeReliable
                ? `${(deadMs / 1000).toFixed(3)} seconds`
                : 'Exact total dead time cannot be verified.'
            }
          >
            {lifeReliable ? time(deadMs) : 'Incomplete'}
          </strong>
          <small>
            {lifeReliable
              ? `${numeric.format((100 * deadMs) / Math.max(1, totals.duration))}% of full time`
              : 'Timeline incomplete'}
          </small>
        </div>
        <div>
          <span>Deaths</span>
          <strong>{totals.deaths}</strong>
          <small>Resurrection does not erase these</small>
        </div>
        <div>
          <span title="Earliest recorded raid death in a pull, including simultaneous ties. This does not establish who caused a wipe.">
            First-death pulls
          </span>
          <strong>{totals.firstDeaths}</strong>
          <small>{totals.returns} recorded resurrections</small>
        </div>
      </div>
      <section className="death-evidence" aria-label="Death evidence">
        <div className="section-heading">
          <h4>
            <Skull size={16} />
            Deaths to review
          </h4>
          <span className="small muted">Full encounter timeline</span>
        </div>
        {!deaths.length && (
          <p className="empty">
            No recorded deaths in this {selected ? 'pull' : 'role selection'}.
          </p>
        )}
        {deaths
          .slice(0, eventLimit)
          .map(({ event, fight, deadMs: intervalMs, evidence, url }, i) => (
            <article className="death-event" key={`${fight.id}:${event.timestamp}:${i}`}>
              <div>
                <strong>
                  #{fight.id} · {fight.name}
                </strong>
                <small>
                  {time(event.timestamp - fight.startTime)} into pull ·{' '}
                  {fight.kill ? 'Kill' : 'Wipe'}
                  {intervalMs !== null
                    ? ` · ${time(intervalMs)} dead`
                    : ' · Dead duration unverified'}
                </small>
                {evidence?.abilityId && evidence.ability && (
                  <small>Recorded killing ability: {evidence.ability}</small>
                )}
              </div>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="evidence-link">
                  View death
                  <ExternalLink size={13} />
                </a>
              ) : (
                <span className="small muted">Synthetic event</span>
              )}
            </article>
          ))}
        {deaths.length > eventLimit && (
          <button className="text-button" onClick={() => setEventLimit((n) => n + 12)}>
            Show {Math.min(12, deaths.length - eventLimit)} more deaths <ChevronRight size={14} />
          </button>
        )}
      </section>
      <details className="context-details">
        <summary>
          Output, preparation & observations <span>Measured facts</span>
        </summary>
        <div className="raw-summary">
          <span>
            <b>{output.format(totals.damage / Math.max(1, totals.duration / 1000))}</b> DPS
          </span>
          <span>
            <b>{output.format(totals.healing / Math.max(1, totals.duration / 1000))}</b> HPS
          </span>
          <span>
            <b>{output.format(totals.taken)}</b> damage taken
          </span>
          <span>
            <b>{totals.casts}</b> casts
          </span>
        </div>
        <p className="small muted">
          Output contributes as shown above. Preparation, item usage, damage taken and raw cast
          counts are factual context; they do not add points or penalties.
        </p>
        <div className="preparation-summary">
          <h4>
            Preparation & item usage{' '}
            <span>
              {snapshots.length}/{rows.length} start snapshots
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
              <dd>{gearLabel('enchantsObserved')}</dd>
            </div>
            <div>
              <dt>Observed gems</dt>
              <dd>{gearLabel('gemsObserved')}</dd>
            </div>
          </dl>
        </div>
        {observations.length > 0 && (
          <div className="event-list">
            <h4>Recorded observations</h4>
            {observations.slice(0, 20).map((e, i) => (
              <article className="event" key={`${e.fightId}:${e.timestamp}:${i}`}>
                <div>
                  <time>Pull #{e.fightId}</time>
                  <strong>{e.ability}</strong>
                </div>
                <p>{e.description}</p>
                {e.url && (
                  <a href={e.url} target="_blank" rel="noreferrer">
                    View in Warcraft Logs <ExternalLink size={12} />
                  </a>
                )}
              </article>
            ))}
            {observations.length > 20 && (
              <p className="small muted">Select a pull to narrow these observations.</p>
            )}
          </div>
        )}
      </details>
      {!selected && player.perBoss.length > 1 && (
        <details className="context-details">
          <summary>Score by boss</summary>
          <div className="boss-summary-list">
            {player.perBoss.map((b) => (
              <div key={`${b.encounterId}:${b.difficulty}`}>
                <span>
                  {b.name}
                  <small>
                    {difficultyName(b.difficulty)} · {b.pulls} pulls as {roleLabel(player.role)}
                  </small>
                </span>
                <CompositeScore assessment={b.execution} />
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
