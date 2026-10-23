import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Analysis } from '../shared/types.js';

export default function ReviewPriorities({
  analysis,
  onInspect,
}: {
  analysis: Analysis;
  onInspect: (id: number) => void;
}) {
  const [kind, setKind] = useState('all'),
    [limit, setLimit] = useState(8);
  const findings = analysis.findings.filter(
    (f) =>
      kind === 'all' ||
      (kind === 'mechanics' ? f.confidence === 'observed' : f.confidence === 'inferred'),
  );
  return (
    <section className="panel findings">
      <div className="section-heading">
        <h3>Review priorities</h3>
        <select
          aria-label="Review category"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setLimit(8);
          }}
        >
          <option value="all">All observations</option>
          <option value="mechanics">Recurring mechanics</option>
          <option value="wipes">Wipe review</option>
        </select>
      </div>
      <p className="small muted">
        Evidence to review together. A first death is not proof of who caused a wipe.
      </p>
      {findings.slice(0, limit).map((finding, index) => (
        <article key={index}>
          <span className={`tag ${finding.confidence === 'observed' ? 'observed' : ''}`}>
            {finding.confidence === 'observed' ? 'Observed pattern' : 'Review starting point'}
          </span>
          <h4>{finding.title}</h4>
          <p>{finding.detail}</p>
          {finding.actorId && (
            <button className="text-button" onClick={() => onInspect(finding.actorId!)}>
              Inspect evidence <ArrowRight size={12} />
            </button>
          )}
        </article>
      ))}
      {!findings.length && <p className="muted">No observations match this review category.</p>}
      {findings.length > limit && (
        <button className="secondary review-more" onClick={() => setLimit((n) => n + 8)}>
          Show more ({findings.length - limit} remaining)
        </button>
      )}
    </section>
  );
}
