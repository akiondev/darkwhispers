import type { ExecutionAssessment } from '../shared/types.js';
import { Score } from './presentation.js';

export const componentNames = {
  mechanics: 'Mechanics',
  output: 'Output',
  survival: 'Survival',
  preparation: 'Preparation',
} as const;
export const componentOrder = ['mechanics', 'output', 'survival', 'preparation'] as const;
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
export const points = (value: number) => number.format(value);

export function CompositeScore({ assessment }: { assessment: ExecutionAssessment }) {
  const composite = assessment.composite;
  if (assessment.score !== null || !composite) return <Score value={assessment.score} />;
  return (
    <span
      className="score-range"
      title="Possible total score range. Some required evidence is incomplete; no missing weight is redistributed."
    >
      <span>
        {Math.floor(composite.lower)}–{Math.ceil(composite.upper)}
      </span>
      <small>Preliminary</small>
    </span>
  );
}

export function ScoreBreakdown({ assessment }: { assessment: ExecutionAssessment }) {
  const composite = assessment.composite;
  if (!composite) return null;
  return (
    <section className="composite-breakdown" aria-label="Score breakdown">
      <div className="section-heading">
        <h4>How this score adds up</h4>
        <span className="small muted">Fixed weights for this role</span>
      </div>
      <div className="component-grid">
        {componentOrder.map((key) => {
          const component = composite.components[key];
          const complete = component.score !== null;
          const explanation =
            key === 'mechanics' && assessment.checkedMechanics > 0
              ? `${assessment.passedChecks} verified clean checks, ${assessment.failedChecks} failed checks.${assessment.missedWhileDead ? ` ${assessment.missedWhileDead} checks could not be judged while dead.` : ''}`
              : key === 'survival' && complete
                ? `${points(assessment.alivePercent)}% of full recorded time alive. ${assessment.deaths ?? 0} recorded deaths; resurrections do not erase earlier dead time.`
                : component.reason;
          return (
            <div className={`component-card component-${key}`} key={key}>
              <span>{componentNames[key]}</span>
              <strong>
                {complete
                  ? points(component.points)
                  : `${points(component.lower)}–${points(component.upper)}`}
                <small> / {points(component.weight * 100)}</small>
              </strong>
              <div className="component-track" aria-hidden="true">
                <i
                  style={{
                    width: `${component.weight ? (100 * component.lower) / (component.weight * 100) : 0}%`,
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
        {componentOrder.map((key, index) => {
          const component = composite.components[key];
          return (
            <span key={key}>
              {index > 0 && <b> + </b>}
              {component.score !== null
                ? points(component.points)
                : `[${points(component.lower)}–${points(component.upper)}]`}
            </span>
          );
        })}
        <b> = </b>
        <CompositeScore assessment={assessment} />
      </p>
      {!composite.complete && (
        <p className="small muted">
          This is a possible range, not an estimated score. Missing evidence cannot earn full
          points.
        </p>
      )}
    </section>
  );
}
