import { useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Job } from '../shared/types.js';
import { analysisExpiresAt, analysisLink } from '../shared/share.js';

export default function ShareLink({ job }: { job: Job }) {
  const link = analysisLink(window.location.origin, job.id);
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const expires = analysisExpiresAt(job.createdAt);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setMessage('Link copied. Ready to share.');
    } catch {
      input.current?.focus();
      input.current?.select();
      setMessage('Automatic copying is unavailable. Copy the selected link manually.');
    }
  }
  return (
    <div className="share-link">
      <p>
        Share this exact result, including the selected bosses, pulls and scoring window. Opening
        the link does not run a new analysis.
      </p>
      <label htmlFor="share-url">Unique analysis link</label>
      <div className="share-copy">
        <input
          id="share-url"
          ref={input}
          value={link}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
        <button className="primary" onClick={() => void copy()}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <p className="share-feedback" role="status" aria-live="polite">
        {message}
      </p>
      <p className="small muted">
        Anyone with this link can view the report and player results. Available until{' '}
        <time dateTime={expires.toISOString()}>
          {expires.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
        </time>{' '}
        (seven days after analysis creation). Links are not listed publicly.
      </p>
    </div>
  );
}
