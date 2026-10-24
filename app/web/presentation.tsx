import { CircleHelp, Heart, Shield, Swords } from 'lucide-react';
import type { Role } from '../shared/types.js';
import { scoreBand, scoreLabel } from '../shared/score.js';
export const duration = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export function RoleIcon({ role }: { role: Role }) {
  const Icon =
    role === 'tank' ? Shield : role === 'healer' ? Heart : role === 'dps' ? Swords : CircleHelp;
  return <Icon size={18} className={`role-icon role-${role}`} aria-hidden="true" />;
}
export function Score({ value }: { value: number | null }) {
  return (
    <span
      className={`score ${scoreBand(value)}`}
      title={
        value === null
          ? 'Score unavailable. Open player details for the recorded reason.'
          : 'Weighted mechanic completion, output and survival. Open player details for the calculation and evidence.'
      }
    >
      {scoreLabel(value)}
    </span>
  );
}
