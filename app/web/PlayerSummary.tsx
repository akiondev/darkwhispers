import type { Analysis, RankedPlayer } from '../shared/types.js';
import { bossContributions, playerExplanation } from '../shared/player-explanation.js';
import { scoreLabel } from '../shared/score.js';
import RoleSummary from './RoleAssessment.js';

export default function PlayerSummary({
  player,
  analysis,
  onEvidence,
}: {
  player: RankedPlayer;
  analysis: Analysis;
  onEvidence: () => void;
}) {
  if (player.assessment)
    return <RoleSummary player={player} analysis={analysis} onEvidence={onEvidence} />;
  const { mechanics, alive, scored, losses, strengths } = playerExplanation(player);
  const tank = player.tankReview;
  const tempest = analysis.pulls.some(
    (p) =>
      p.fight.friendlyPlayers.includes(player.id) && p.mechanicRule?.startsWith('sszorak-tempest'),
  );
  const contactRuleOnly = analysis.report.source === 'warcraftlogs' && tempest;
  const ungradedTank = !!tank && player.score === null;
  const anyCutoff =
    analysis.selection.excludeWipeTail &&
    analysis.pulls.some((p) => p.evaluation && p.fight.friendlyPlayers.includes(player.id));
  const missing = ['output', 'utility'].filter(
    (key) => !scored.some((b) => b.categories[key as 'output' | 'utility'].applied),
  );
  return (
    <section className="player-summary" aria-label="Performance summary">
      <h3>{ungradedTank ? 'Tank summary' : 'Why this score'}</h3>
      <p className="summary-verdict">
        {ungradedTank
          ? 'Included in the player list. No overall tank score yet: this is not a zero or a last-place rank.'
          : player.score === null
            ? 'Not ranked overall: too few selected bosses have a comparable score. Available boss results are shown below.'
            : tank
              ? `Tank task result: ${scoreLabel(player.score, player.provisional)} / 100, from verified task criteria.`
              : `${player.score >= 90 ? 'Strong' : player.score >= 70 ? 'Mixed' : 'Lower'} measured result: ${scoreLabel(player.score, player.provisional)} / 100. ${strengths.length ? `${strengths.map((s) => `${s.name} (${s.score.toFixed(1)}/100)`).join(' and ')} ${strengths.length === 1 ? 'supports' : 'support'} this result.` : 'The scored factors below explain the result.'}`}
      </p>
      {ungradedTank && tank && (
        <p>
          {tank.protectionPercent === null
            ? 'No reliable primary-protection measurement is available.'
            : `Primary class protection was present on ${tank.facts.protectedMeleeEvents} of ${tank.facts.knownMeleeEvents} melee attempts with known aura state (${tank.protectionPercent.toFixed(1)}%). ${tank.facts.unknownMeleeEvents} ${tank.facts.unknownMeleeEvents === 1 ? 'attempt had' : 'attempts had'} unknown state.`}{' '}
          Boss duties, swaps and defensive decisions still need verified criteria. Buff coverage
          alone cannot establish tank quality.
        </p>
      )}
      <div className="summary-facts">
        <div>
          <span>
            {contactRuleOnly ? 'Tempest windows with contact' : 'Failed mechanic opportunities'}
          </span>
          <strong>
            {mechanics ? `${mechanics.failures} of ${mechanics.opportunities}` : 'Not measured'}
          </strong>
          {mechanics && (
            <small>
              {mechanics.clean}{' '}
              {contactRuleOnly ? 'without direct contact' : 'without a recorded failure'} ·{' '}
              {mechanics.score.toFixed(1)}%{tank ? ' · observation only' : ' mechanic result'}
            </small>
          )}
        </div>
        <div>
          <span>Time alive · scored window</span>
          <strong>{alive.toFixed(1)}%</strong>
          <small>
            {player.deaths} full-pull deaths
            {player.lateDeaths ? ` · ${player.lateDeaths} outside scoring window` : ''}. Deaths do
            not establish fault.
          </small>
        </div>
      </div>
      {mechanics && (
        <p className="small">
          {contactRuleOnly
            ? 'One opportunity is one recorded Tempest cast window while you were alive. Direct contact counts at most once per window; repeated hits and periodic DoT ticks do not add failures. These are windows across pulls, not a count of pulls or deaths.'
            : 'An opportunity is an evaluated mechanic check; a failure is a recorded failed check. Repeated damage events are not automatically separate mistakes.'}{' '}
          {anyCutoff &&
            'Only opportunities before the displayed raid-collapse/enrage cutoff count here.'}
          {mechanics.failures > 0 && (
            <>
              {' '}
              <button className="summary-evidence" onClick={onEvidence}>
                Review scored events & pulls →
              </button>
            </>
          )}
        </p>
      )}
      {!tank && player.score !== null && (
        <>
          <p>
            {losses[0]?.points > 0.001
              ? `Largest measured score reduction: ${losses[0].name.toLowerCase()}, ${losses[0].points.toFixed(1)} points below a perfect result across the scored bosses. Review those events first.`
              : 'No points were lost in the applied categories.'}{' '}
            {missing.length > 0 &&
              `${missing.map((key) => (key === 'output' ? 'Output' : 'Assigned utility')).join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not scored for these pulls.`}{' '}
            {player.provisional &&
              'This is a partial comparison, not a complete assessment of raid skill.'}
          </p>
          {scored.length === 1 ? (
            <p className="summary-formula">
              {bossContributions(scored[0])
                .map((c) => `${c.name} ${c.score.toFixed(1)} × ${c.weight.toFixed(1)}%`)
                .join(' + ')}{' '}
              = {scoreLabel(player.score)} / 100
              <small>
                Effective weights after unavailable categories are excluded. Calculation uses
                unrounded values.
              </small>
            </p>
          ) : (
            <p className="small">
              Overall score = equal average of {scored.length} scored boss results. Each boss has
              equal weight regardless of pull count; see the exact inputs in Boss breakdown.
            </p>
          )}
        </>
      )}
      {contactRuleOnly && (
        <p className="small muted">
          Mechanic coverage here is Tempest contact only. Other boss mechanics and assignments are
          not graded; contact alone does not establish who caused it.
        </p>
      )}
    </section>
  );
}
