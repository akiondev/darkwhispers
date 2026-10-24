import type { ExecutionAssessment } from '../shared/types.js';
import { Score } from './presentation.js';

export const componentNames = {
  mechanics: 'Mechanics',
  output: 'Output',
  survival: 'Survival',
} as const;
export const componentOrder = ['mechanics', 'output', 'survival'] as const;
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
export const points = (value: number) => number.format(value);

export function CompositeScore({ assessment }: { assessment: ExecutionAssessment }) {
  return <Score value={assessment.score} />;
}

export function ScoreBreakdown({ assessment }: { assessment: ExecutionAssessment }) {
  const composite = assessment.composite;
  if (!composite) return null;
  const included = componentOrder.filter((key) => composite.components[key].weight > 0);
  return (
    <section className="composite-breakdown" aria-label="Score breakdown">
      <div className="section-heading">
        <h4>How this score adds up</h4>
        <span className="small muted">Points contributing to this score</span>
      </div>
      <div className={`component-grid component-count-${included.length}`}>
        {included.map((key) => {
          const component = composite.components[key];
          const complete = component.score !== null;
          const explanation =
            key === 'mechanics' && assessment.checkedMechanics > 0
              ? `${assessment.passedChecks} completed, ${assessment.failedChecks} failed.${assessment.missedWhileDead ? ` ${assessment.missedWhileDead} not completed while dead; these are not mechanic failures.` : ''}`
              : key === 'survival' && complete && assessment.scoredPulls < assessment.totalPulls
                ? `Survival points use ${assessment.scoredPulls}/${assessment.totalPulls} verified attended pulls. Recorded deaths from excluded pulls remain visible below.`
                : key === 'survival' && complete
                  ? `${points(assessment.alivePercent)}% of full recorded time alive. ${assessment.deaths ?? 0} recorded deaths; resurrections do not erase earlier dead time.`
                  : component.reason;
          return (
            <div className={`component-card component-${key}`} key={key}>
              <span>{componentNames[key]}</span>
              <strong>
                {complete ? points(component.points) : '—'}
                <small> / {points(component.weight * 100)}</small>
              </strong>
              <div className="component-track" aria-hidden="true">
                <i
                  style={{
                    width: `${complete ? component.score : 0}%`,
                  }}
                />
              </div>
              <p>{explanation}</p>
            </div>
          );
        })}
      </div>
      <p
        className="composite-equation"
        title="Displayed points are rounded. The total uses full precision."
      >
        {included.map((key, index) => {
          const component = composite.components[key];
          return (
            <span key={key}>
              {index > 0 && <b> + </b>}
              {component.score !== null ? points(component.points) : '—'}
            </span>
          );
        })}
        <b> = </b>
        <CompositeScore assessment={assessment} />
      </p>
      {composite.components.mechanics.weight === 0 && (
        <p className="small muted">
          No comparable mechanic checks are scored for this selection. Output and survival use the
          same fallback weights for everyone in the same pull and role.
        </p>
      )}
      {composite.scope === 'mixed' && (
        <p className="small muted">
          Each pull is scored first, then its points are weighted by full encounter duration. Some
          pulls use output and survival only, so the maximum weights above are averages too. Only
          scored pulls contribute points; recorded death counts also include excluded pulls.
        </p>
      )}
      {assessment.score === null && (
        <p className="score-unavailable">Score unavailable: {assessment.reasons.join(' ')}</p>
      )}
    </section>
  );
}
