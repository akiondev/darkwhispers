import { useEffect, useState } from 'react';
import { History, ArrowUpRight } from 'lucide-react';
import type { RecentAnalysis } from '../shared/types.js';
export default function RecentAnalyses() {
  const [rows, setRows] = useState<RecentAnalysis[]>([]),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/recent-analyses', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const d = await r.json();
        if (!Array.isArray(d.analyses)) throw Error();
        setRows(d.analyses);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [retry]);
  return (
    <section className="recent-analyses" aria-label="Latest analyzed public logs">
      <div className="section-heading">
        <h2>
          <History size={19} /> Latest analyzed logs
        </h2>
        <span className="small muted">Public reports · last 7 days</span>
      </div>
      {failed ? (
        <p className="small muted">
          Recent logs could not load.{' '}
          <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </p>
      ) : !rows.length ? (
        <p className="muted small">
          Completed public analyses will appear here. Private, unlisted and synthetic reports are
          excluded.
        </p>
      ) : (
        <div className="recent-grid">
          {rows.map((r) => (
            <a className="recent-card" href={`/?analysis=${encodeURIComponent(r.id)}`} key={r.id}>
              <div>
                <strong>{r.title}</strong>
                <ArrowUpRight size={17} />
              </div>
              <span>
                {r.bosses} bosses · {r.pulls} pulls · {r.players} players
              </span>
              <small>
                {new Date(r.generatedAt).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                · v{r.version}
              </small>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
