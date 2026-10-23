import type { TankReview as Review } from '../shared/types.js';
import { TANK_CATEGORIES } from '../shared/tanks.js';
const number = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export default function TankReview({ review }: { review: Review }) {
  const f = review.facts;
  return (
    <section className="tank-review" aria-label="Tank evidence review">
      <div className="notice subtle">
        <div>
          <strong>
            Tank assessment ·{' '}
            {review.status === 'partial' ? 'partial evidence' : 'insufficient evidence'}
          </strong>
          <p>
            Observed class protection and pressure events. No composite score or raid position is
            assigned while core tank duties cannot be graded reliably.
          </p>
        </div>
      </div>
      <div className="stats mini">
        <div>
          <span>Primary protection · melee attempts</span>
          <strong>
            {review.protectionPercent === null
              ? 'Not available'
              : `${review.protectionPercent.toFixed(1)}%`}
          </strong>
          <small>
            {f.protectedMeleeEvents} / {f.knownMeleeEvents} attempts with known aura state ·{' '}
            {f.unknownMeleeEvents} unknown
          </small>
        </div>
        <div>
          <span>Observed melee pressure</span>
          <strong>{(f.pressureMs / 60000).toFixed(1)} min</strong>
          <small>5-second windows after melee attempts, clipped to time alive</small>
        </div>
        <div>
          <span>Protection gap episodes</span>
          <strong>{f.knownMeleeEvents ? f.protectionGapEpisodes : 'Not available'}</strong>
          <small>Review observations · no automatic penalty</small>
        </div>
        <div>
          <span>Large direct hits</span>
          <strong>{f.resourceHits ? f.largeHits : 'Not available'}</strong>
          <small>
            At least 25% max HP effective damage · {f.resourceHits} hits had target HP data
          </small>
        </div>
        <div>
          <span>Large hits with a defensive aura</span>
          <strong>
            {f.resourceHits ? `${f.largeHitsWithDefense} / ${f.largeHits}` : 'Not available'}
          </strong>
          <small>Aura presence does not prove the correct damage school or optimal timing</small>
        </div>
        <div>
          <span>Recorded self-healing</span>
          <strong>{number.format(f.selfHealing)}</strong>
          <small>Catalogue self-heals only · overheal and absorbs excluded</small>
        </div>
      </div>
      <p className="small muted">
        {f.deathsUnderPressure} deaths within 5 seconds of a recorded direct enemy hit. This does
        not establish fault. Evidence spans {review.pullsMeasured} pulls; {review.pullsMissing}{' '}
        selected pulls have no compatible tank facts.
      </p>
      <details className="tank-method">
        <summary>Tank scoring requirements</summary>
        <p className="small muted">
          Proposed fixed role weights. These are not redistributed into a partial avoidance score.
          Coverage alone does not validate a tank grade.
        </p>
        {TANK_CATEGORIES.map((c) => (
          <div className="tank-requirement" key={c.name}>
            <strong>
              {c.name} · {c.weight}%
            </strong>
            <span>{c.reason}</span>
          </div>
        ))}
      </details>
      {review.reasons.map((reason) => (
        <p className="small muted" key={reason}>
          {reason}
        </p>
      ))}
    </section>
  );
}
