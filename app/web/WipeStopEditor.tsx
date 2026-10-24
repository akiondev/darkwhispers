import { useEffect, useState } from 'react';
import type { Fight } from '../shared/types.js';

export function formatStop(ms: number): string {
  const seconds = ms / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(ms % 1000 ? 3 : 0).padStart(ms % 1000 ? 6 : 2, '0')}`;
}
export function parseStop(text: string): number | null {
  const match = /^(\d+):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;
  const value =
    Number(match[1]) * 60000 + Number(match[2]) * 1000 + Number((match[3] ?? '').padEnd(3, '0'));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
export default function WipeStopEditor({
  fight,
  value,
  logged,
  disabled,
  onChange,
}: {
  fight: Fight;
  value?: number;
  logged?: number;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : formatStop(value));
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(value === undefined ? '' : formatStop(value));
    setError('');
  }, [value]);
  const apply = () => {
    if (!draft.trim()) {
      setError('');
      if (value !== undefined) onChange(undefined);
      return;
    }
    const parsed = parseStop(draft);
    if (parsed === null || parsed > fight.endTime - fight.startTime) {
      setError('Use m:ss inside this pull.');
      return;
    }
    setError('');
    if (parsed !== value) onChange(parsed);
  };
  return (
    <div className="wipe-stop-editor">
      <label htmlFor={`wipe-stop-${fight.id}`}>Shared stop</label>
      <input
        id={`wipe-stop-${fight.id}`}
        aria-label={`Wipe stop for pull ${fight.id}`}
        placeholder={
          logged === undefined ? 'Set m:ss' : `Logged ${formatStop(logged - fight.startTime)}`
        }
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
        }}
        aria-invalid={!!error}
      />
      <small className={error ? 'failed-text' : 'muted'}>
        {error ||
          (value !== undefined
            ? 'Manual · applies to everyone'
            : logged !== undefined
              ? 'Logged call · automatic'
              : 'No call · not scored')}
      </small>
      {value !== undefined && (
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => {
            setDraft('');
            setError('');
            onChange(undefined);
          }}
        >
          Reset
        </button>
      )}
    </div>
  );
}
