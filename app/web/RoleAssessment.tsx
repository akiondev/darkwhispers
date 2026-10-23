import type { Analysis, RankedPlayer, RoleAssessment as Assessment } from '../shared/types.js';
import { scoreLabel } from '../shared/score.js';
import { difficultyName } from '../shared/report-url.js';

export function RoleFactors({
  assessment,
  compact = false,
}: {
  assessment: Assessment;
  compact?: boolean;
}) {
  const a = assessment;
  return (
    <section className="role-assessment" aria-label="Role score calculation">
      <p className="summary-formula">
        <strong>
          {a.factors.reduce((n, f) => n + f.points, 0).toFixed(1)} measured points +{' '}
          {a.factors.reduce((n, f) => n + f.neutralPoints, 0).toFixed(1)} neutral points ={' '}
          {scoreLabel(a.score)} / 100
        </strong>
      </p>
      <p className="small">
        Measured weight: {a.coverage.toFixed(1)}%. Missing-evidence range:{' '}
        <strong>
          {a.lower.toFixed(1)}–{a.upper.toFixed(1)}
        </strong>
        . Unknown weight uses a neutral midpoint of 50; it is not observed good performance. This
        range is not a confidence interval.
      </p>
      <div className="role-factor-list">
        {a.factors.map((f) => (
          <details key={f.key}>
            <summary>
              <strong>{f.name}</strong>
              <span>
                {f.score === null ? 'Unknown' : `${f.score.toFixed(1)} / 100`} ·{' '}
                {f.weight.toFixed(1)}% weight
              </span>
            </summary>
            <p>{f.explanation}</p>
            <small>
              {f.points.toFixed(2)} measured points + {f.neutralPoints.toFixed(2)} neutral points ·{' '}
              {f.measuredWeight.toFixed(1)}% measured weight
            </small>
          </details>
        ))}
      </div>
      {!compact && (
        <p className="small muted">
          Observed factors have fixed role weights. Unverified boss duties and mechanics stay
          unknown rather than becoming invented mistakes or perfect scores.
        </p>
      )}
    </section>
  );
}
export default function RoleSummary({
  player,
  analysis,
  onEvidence,
}: {
  player: RankedPlayer;
  analysis: Analysis;
  onEvidence: () => void;
}) {
  const a = player.assessment!;
  const mechanicName = player.evidence.find((e) => e.kind === 'mechanic')?.ability;
  const strongest = [...a.factors]
    .filter((f) => f.measuredWeight > 0 && f.score !== null)
    .sort((x, y) => y.points - x.points)
    .slice(0, 2);
  const loss = [...a.factors].sort(
    (x, y) => y.measuredWeight - y.points - (x.measuredWeight - x.points),
  )[0];
  return (
    <section className="player-summary" aria-label="Performance summary">
      <h3>Why this role score</h3>
      <p className="summary-verdict">
        {player.name}: <strong>{scoreLabel(a.score, true)} / 100</strong>.{' '}
        {strongest.map((f) => `${f.name} (${f.score!.toFixed(1)}/100)`).join(' and ')} provide the
        main observed contributions.
        {player.bossCoverage < 50 && (
          <>
            {' '}
            Only {player.bosses} of {analysis.summary.bosses} bosses were observed; most of this
            overall result remains unknown, not measured poor play.
          </>
        )}
      </p>
      {loss && loss.measuredWeight - loss.points > 0.01 && (
        <p>
          Largest measured reduction: {loss.name.toLowerCase()},{' '}
          {(loss.measuredWeight - loss.points).toFixed(1)} points. This identifies a review area,
          not responsibility for a wipe.
        </p>
      )}
      <div className="summary-facts">
        <div>
          <span>Participation</span>
          <strong>
            {player.pulls} {player.pulls === 1 ? 'pull' : 'pulls'} · {player.bosses}{' '}
            {player.bosses === 1 ? 'boss' : 'bosses'}
          </strong>
          <small>
            {player.bosses} of {analysis.summary.bosses} selected bosses attended ·{' '}
            {player.confidence} evidence
          </small>
        </div>
        <div>
          <span>
            {player.role === 'tank'
              ? 'Tank contacts · observation only'
              : mechanicName
                ? `${mechanicName} contact windows`
                : 'Verified mechanic opportunities'}
          </span>
          <strong>
            {player.mechanicOpportunities === null
              ? 'No applicable boss rule'
              : `${player.mechanicFailures} of ${player.mechanicOpportunities}`}
          </strong>
          <small>
            {player.role === 'tank'
              ? 'Required tank contacts are not generic avoidance failures.'
              : 'Failure counts describe verified windows, not damage ticks or deaths.'}
          </small>
        </div>
      </div>
      {player.mechanicFailures !== null && player.mechanicFailures > 0 && (
        <button className="summary-evidence" onClick={onEvidence}>
          Review recorded mechanic events & pulls →
        </button>
      )}
      <RoleFactors assessment={a} />
      <details className="tank-method">
        <summary>Difficulty and role contexts</summary>
        {a.contexts.map((c, i) => (
          <p className="small" key={i}>
            {c.name ? `${c.name} · ` : ''}
            {difficultyName(c.difficulty)} · {c.role} · {c.pulls} pulls ·{' '}
            {scoreLabel(c.score, true)}
          </p>
        ))}
        <p className="small muted">
          Bosses and difficulty contexts are calculated separately. Selected bosses have equal
          weight; unattended bosses stay unknown, with neutral midpoint and bounds. All attended
          pulls remain included.
        </p>
      </details>
    </section>
  );
}
