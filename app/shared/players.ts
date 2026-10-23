import type { Role } from './types.js';
export function roleFromSpec(spec: string): Role {
  const value = spec.toLowerCase().replace(/[^a-z]/g, '');
  if (['blood', 'protection', 'guardian', 'brewmaster', 'vengeance'].includes(value)) return 'tank';
  if (['holy', 'discipline', 'restoration', 'mistweaver', 'preservation'].includes(value))
    return 'healer';
  return [
    'arms',
    'fury',
    'retribution',
    'frost',
    'unholy',
    'havoc',
    'devourer',
    'balance',
    'feral',
    'beastmastery',
    'marksmanship',
    'survival',
    'arcane',
    'fire',
    'windwalker',
    'shadow',
    'assassination',
    'outlaw',
    'subtlety',
    'elemental',
    'enhancement',
    'affliction',
    'demonology',
    'destruction',
    'devastation',
    'augmentation',
  ].includes(value)
    ? 'dps'
    : 'unknown';
}
export function summarizeSpecs(specs: Iterable<string>): { spec: string; role: Role } {
  const unique = [...new Set(specs)].filter(Boolean);
  const roles = new Set(unique.map(roleFromSpec));
  return {
    spec: unique.length > 1 ? 'Mixed' : (unique[0] ?? 'Unknown'),
    role: roles.size === 1 ? [...roles][0] : 'unknown',
  };
}
