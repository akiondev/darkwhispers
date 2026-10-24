import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { Selection } from '../shared/types.js';
import { demoData } from '../shared/demo.js';
import { parseReportCode, selectFights } from '../shared/report-url.js';
import type { Store } from './store.js';
import { QueueFullError } from './store.js';
import { ApiError, WclClient } from './wcl.js';
import { VERSION } from '../shared/version.js';
import { clientAddress } from './client-ip.js';
const selectionSchema = z
  .object({
    wipeStops: z
      .record(z.string().regex(/^[1-9]\d*$/), z.number().int().positive())
      .refine((v) => Object.keys(v).length <= 150)
      .optional(),
    encounterId: z.number().int().positive().nullable().default(null),
    difficulty: z.number().int().positive().nullable().default(null),
    mode: z.enum(['all', 'wipes', 'kills']).default('all'),
    fightIds: z.array(z.number().int().positive()).max(150).nullable().default(null),
    excludeWipeTail: z.boolean().default(true),
  })
  .strict();

export async function createApi(
  store: Store,
  client: WclClient,
  enqueue: (id: string) => Promise<void>,
  production = false,
) {
  const app = Fastify({
    logger: production
      ? {
          level: 'info',
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          serializers: {
            req: (req) => ({
              method: req.method,
              url: req.url?.split('?')[0],
              hostname: req.hostname,
            }),
            res: (res) => ({ statusCode: res.statusCode }),
          },
        }
      : false,
    bodyLimit: 16384,
    trustProxy: ['127.0.0.1', '::1'],
    requestTimeout: 60000,
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute', keyGenerator: clientAddress });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin;
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && origin) {
      try {
        const parsed = new URL(origin);
        if (
          ![
            'https://darkwhispers.akion.se',
            'http://127.0.0.1:8878',
            'http://127.0.0.1:8879',
            'http://localhost:8878',
          ].includes(parsed.origin)
        )
          return reply.code(403).send({
            code: 'ORIGIN_REJECTED',
            message: 'This action must originate from DarkWhispers.',
          });
      } catch {
        return reply
          .code(403)
          .send({ code: 'ORIGIN_REJECTED', message: 'Invalid request origin.' });
      }
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof QueueFullError)
      return reply.code(429).send({ code: 'QUEUE_FULL', message: error.message });
    if (error instanceof ApiError)
      return reply.code(error.status).send({ code: error.code, message: error.message });
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ code: 'INVALID_INPUT', message: 'Check the report link and pull selection.' });
    if ((error as any).statusCode === 429)
      return reply.code(429).send({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests. Please wait before trying again.',
      });
    const clientStatus = (error as { statusCode?: number }).statusCode;
    if (clientStatus && clientStatus >= 400 && clientStatus < 500)
      return reply.code(clientStatus).send({
        code: 'INVALID_REQUEST',
        message:
          clientStatus === 413
            ? 'The request is too large.'
            : clientStatus === 415
              ? 'Send this request as application/json.'
              : 'The request could not be read. Check its JSON and fields.',
      });
    req.log.error({ errorName: error instanceof Error ? error.name : 'Unknown' }, 'Request failed');
    return reply.code(500).send({
      code: 'INTERNAL_ERROR',
      message: 'The request could not be completed. Please retry.',
    });
  });
  app.get('/api/status', async () => ({
    version: VERSION,
    liveConfigured: client.configured,
    demoAvailable: true,
    mode: client.configured ? 'live' : 'credentials-required',
  }));
  app.get('/healthz', async () => {
    await store.activeJobs();
    return { status: 'ok', application: 'darkwhispers-app', version: VERSION };
  });
  app.get('/api/demo/report', async () => demoData().report);
  app.get('/api/recent-analyses', async () => ({ analyses: await store.recentAnalyses() }));
  app.post(
    '/api/reports/inspect',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { url } = z
        .object({ url: z.string().max(2048) })
        .strict()
        .parse(req.body);
      let code: string;
      try {
        code = parseReportCode(url);
      } catch (error) {
        throw new ApiError(
          'INVALID_REPORT',
          error instanceof Error ? error.message : 'Invalid report link.',
          400,
        );
      }
      if (!client.configured)
        throw new ApiError(
          'WCL_NOT_CONFIGURED',
          'Live imports need Warcraft Logs credentials on the server. You can explore the clearly marked synthetic demo now.',
          503,
        );
      const cached = await store.getReport(code);
      if (cached) return cached;
      const report = await client.report(code);
      await store.putReport(report);
      return reply.send(report);
    },
  );
  app.post(
    '/api/analyses',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const input = z
        .object({
          reportCode: z.string().max(32),
          demo: z.boolean().default(false),
          selection: selectionSchema,
        })
        .strict()
        .parse(req.body);
      const { wipeStops: _legacyStops, ...automaticSelection } = input.selection;
      const selection = { ...automaticSelection, excludeWipeTail: false } as Selection;
      if (!input.demo && !client.configured)
        throw new ApiError(
          'WCL_NOT_CONFIGURED',
          'Live imports need Warcraft Logs credentials on the server. No live report was analyzed.',
          503,
        );
      let report;
      if (input.demo) report = demoData().report;
      else {
        try {
          parseReportCode(input.reportCode);
        } catch {
          throw new ApiError('INVALID_REPORT', 'Invalid report code.', 400);
        }
        report = await store.getReport(input.reportCode);
      }
      if (!report) {
        report = await client.report(input.reportCode);
        await store.putReport(report);
      }
      const selected = selectFights(report, selection);
      if (selection.fightIds && new Set(selection.fightIds).size !== selected.length)
        throw new ApiError(
          'SELECTION_CHANGED',
          'Some selected pulls are no longer available or do not match these filters. Load the report again.',
          422,
        );
      if (!selected.length)
        throw new ApiError('EMPTY_SELECTION', 'Choose at least one completed boss pull.', 422);
      if (selected.length > 150)
        throw new ApiError('REPORT_TOO_LARGE', 'Select at most 150 pulls in the prototype.', 422);
      const frozen = { ...selection, fightIds: selected.map((f) => f.id) };
      const job = await store.createJob(report.code, frozen, input.demo);
      try {
        await enqueue(job.id);
      } catch {
        await store.updateJob(job.id, {
          status: 'failed',
          error: 'The background worker queue is unavailable.',
          errorCode: 'QUEUE_UNAVAILABLE',
        });
        throw new ApiError(
          'QUEUE_UNAVAILABLE',
          'The analysis queue is temporarily unavailable.',
          503,
        );
      }
      return reply.code(202).send({ id: job.id, status: job.status });
    },
  );
  app.get('/api/analyses/:id', async (req) => {
    const id = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    let job = await store.getJob(id);
    if (!job)
      throw new ApiError(
        'ANALYSIS_NOT_FOUND',
        'This analysis was not found or its seven-day retention period expired.',
        404,
      );
    const seen = new Set([id]);
    for (let depth = 0; job.replacementId && depth < 5; depth++) {
      if (seen.has(job.replacementId))
        throw new ApiError('INVALID_REPLACEMENT', 'This repaired analysis link is invalid.');
      seen.add(job.replacementId);
      const next = await store.getJob(job.replacementId);
      if (!next) break;
      if (next.reportCode !== job.reportCode)
        throw new ApiError(
          'INVALID_REPLACEMENT',
          'This repaired analysis refers to a different report.',
        );
      job = next;
    }
    return job;
  });
  return app;
}
