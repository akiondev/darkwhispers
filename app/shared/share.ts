export const ANALYSIS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sharedAnalysisId(search: string): string | null {
  const ids = new URLSearchParams(search).getAll('analysis');
  if (!ids.length) return null;
  if (ids.length !== 1 || !UUID.test(ids[0]))
    throw new Error('This analysis link is invalid. Check that you copied the entire link.');
  return ids[0];
}

export function analysisLink(origin: string, id: string): string {
  if (!UUID.test(id)) throw new Error('Invalid analysis ID.');
  const url = new URL('/', origin);
  url.searchParams.set('analysis', id);
  return url.href;
}

export function analysisExpiresAt(createdAt: string): Date {
  return new Date(Date.parse(createdAt) + ANALYSIS_RETENTION_MS);
}
