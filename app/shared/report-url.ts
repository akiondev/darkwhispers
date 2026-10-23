const CODE = /^[a-zA-Z0-9]{16}$/;
export function parseReportCode(input: string): string {
  const text = input.trim();
  if (CODE.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('Paste a valid Warcraft Logs report link or its 16-character report code.');
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    (host !== 'warcraftlogs.com' &&
      !/^(www|[a-z]{2}|classic|fresh|sod)\.warcraftlogs\.com$/.test(host)) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error('Only HTTPS report links from warcraftlogs.com are accepted.');
  }
  const code = /^\/reports\/([A-Za-z0-9]{16})(?:\/|$)/.exec(url.pathname)?.[1];
  if (!code || !CODE.test(code))
    throw new Error('This link does not contain a valid Warcraft Logs report code.');
  return code;
}
export function selectFights(
  report: import('./types.js').Report,
  selection: import('./types.js').Selection,
) {
  return report.fights.filter(
    (f) =>
      f.encounterId > 0 &&
      !f.inProgress &&
      f.endTime > f.startTime &&
      (selection.encounterId === null || f.encounterId === selection.encounterId) &&
      (selection.difficulty === null || f.difficulty === selection.difficulty) &&
      (selection.mode === 'all' || (selection.mode === 'kills' ? f.kill : !f.kill)) &&
      (!selection.fightIds || selection.fightIds.includes(f.id)),
  );
}
export function evidenceUrl(
  report: import('./types.js').Report,
  fight: number,
  actor: number,
  time: number,
  view: string,
): string | null {
  if (report.source === 'demo') return null;
  return `https://www.warcraftlogs.com/reports/${report.code}?fight=${fight}&type=${view}&source=${actor}&start=${Math.max(0, Math.floor(time - 5000))}&end=${Math.floor(time + 5000)}`;
}
export const difficultyName = (value: number) =>
  ({ 1: 'LFR', 2: 'Flex', 3: 'Normal', 4: 'Heroic', 5: 'Mythic', 10: 'Mythic+', 17: 'LFR' })[
    value
  ] ?? `Difficulty ${value}`;
