/** All roles use the same formula; rankings stay separate. */
export { EXECUTION_MODEL_VERSION as ROLE_MODEL_VERSION, scoreExecution } from './execution.js';
export const ROLE_WEIGHTS = {
  dps: { mechanics: 70, survival: 30 },
  healer: { mechanics: 70, survival: 30 },
  tank: { mechanics: 70, survival: 30 },
  unknown: { mechanics: 70, survival: 30 },
} as const;
