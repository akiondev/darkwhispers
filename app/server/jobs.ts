import { analyze } from '../shared/analysis.js';
import { PULL_CACHE_VERSION } from '../shared/version.js';
import { demoData } from '../shared/demo.js';
import { selectFights } from '../shared/report-url.js';
import type { PullData, Report } from '../shared/types.js';
import { ingestPull } from './ingest.js';
import { ApiError, WclClient } from './wcl.js';
import type { Store } from './store.js';

export async function runAnalysis(id: string, store: Store, client: WclClient): Promise<void> {
  const job = await store.getJob(id);
  if (!job || !['queued', 'running'].includes(job.status)) return;
  await store.updateJob(id, { status: 'running', progress: 2, message: 'Loading report metadata' });
  try {
    let report: Report;
    let pulls: PullData[] = [];
    if (job.demo) {
      const demo = demoData();
      report = demo.report;
      pulls = demo.pulls;
    } else {
      report = (await store.getReport(job.reportCode)) ?? (await client.report(job.reportCode));
      await store.putReport(report);
      const selected = selectFights(report, job.selection);
      if (job.selection.fightIds && new Set(job.selection.fightIds).size !== selected.length)
        throw new ApiError(
          'SELECTION_CHANGED',
          'Some selected pulls changed while queued. Load the report again.',
          422,
        );
      if (!selected.length)
        throw new ApiError('EMPTY_SELECTION', 'No completed boss pulls match this selection.', 422);
      if (selected.length > 150)
        throw new ApiError(
          'REPORT_TOO_LARGE',
          'The prototype supports up to 150 selected pulls per analysis.',
          422,
        );
      const keys = selected.map(
        (f) =>
          `${report.code}:${report.revision}:${f.id}:${f.startTime}:${f.endTime}:${PULL_CACHE_VERSION}`,
      );
      const cached = await Promise.all(keys.map((key) => store.getPull(key)));
      const abilities = cached.every(Boolean)
        ? new Map<number, string>()
        : await client.abilities(report.code);
      let nextPull = 0,
        finishedPulls = 0;
      let failure: unknown = null;
      const download = async () => {
        while (!failure && nextPull < selected.length) {
          const index = nextPull++,
            fight = selected[index];
          try {
            let pull = cached[index];
            if (!pull) {
              pull = await ingestPull(client, report, fight, abilities, async () => {});
              await store.putPull(keys[index], pull);
            }
            pulls.push(pull);
            finishedPulls++;
            await store.updateJob(id, {
              progress: Math.round(5 + (finishedPulls / selected.length) * 88),
              message: `Ready: ${finishedPulls} of ${selected.length} pulls`,
            });
          } catch (error) {
            failure = error;
          }
        }
      };
      // Two pulls in flight, at most three upstream requests at once in the client.
      // Completed pulls are committed independently, so retries reuse real work.
      await Promise.all([download(), download()]);
      if (failure) throw failure;
      pulls.sort((a, b) => a.fight.id - b.fight.id);
    }
    await store.updateJob(id, { progress: 96, message: 'Calculating comparable player standings' });
    const result = analyze(report, pulls, job.selection);
    await store.updateJob(id, {
      status: 'complete',
      progress: 100,
      message: 'Analysis complete',
      result,
    });
  } catch (error) {
    const known = error instanceof ApiError;
    await store.updateJob(id, {
      status: 'failed',
      message: 'Analysis could not be completed',
      error: known
        ? error.message
        : error instanceof Error
          ? error.message
          : 'An unexpected error stopped this analysis.',
      errorCode: known ? error.code : 'ANALYSIS_FAILED',
    });
  }
}
