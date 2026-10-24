import type { Player, Report } from './types.js';
/** Identity comes from report actors + WCL's region/realm directory, never a guessed realm. */
export function characterLinks(player: Player, report: Report) {
  if (report.source === 'demo') return { warcraftLogs: null, raiderIO: null, armory: null };
  const fallback = `https://www.warcraftlogs.com/reports/${report.code}?source=${player.id}`;
  const p = player.profile;
  if (!p || !/^(eu|us|kr|tw|cn)$/.test(p.region) || !p.realm || !player.name)
    return { warcraftLogs: fallback, raiderIO: null, armory: null };
  const path = [p.region, p.realm, p.name ?? player.name].map(encodeURIComponent).join('/');
  return {
    warcraftLogs: `https://www.warcraftlogs.com/character/${path}`,
    raiderIO: `https://raider.io/characters/${path}`,
    armory:
      p.region === 'cn' ? null : `https://worldofwarcraft.blizzard.com/en-gb/character/${path}`,
  };
}
