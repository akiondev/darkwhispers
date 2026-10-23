import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Job, PullData, Report, Selection } from '../shared/types.js';
export const MAX_ACTIVE_JOBS = 12;
const MAX_AGE_MS = 2 * 3600000;
const active = (job: Job) => job.status === 'queued' || job.status === 'running';
const expired = (job: Job) => active(job) && Date.parse(job.createdAt) <= Date.now() - MAX_AGE_MS;
const expiry: Partial<Job> = {
  status: 'failed',
  errorCode: 'ANALYSIS_EXPIRED',
  error:
    'This analysis exceeded its two-hour processing window. Start a new analysis; completed pulls remain cached.',
  message: 'Analysis expired',
};
export class QueueFullError extends Error {
  constructor() {
    super('The analysis queue is full. Try again shortly.');
  }
}
export interface Store {
  getReport(code: string): Promise<Report | null>;
  putReport(report: Report): Promise<void>;
  getPull(key: string): Promise<PullData | null>;
  putPull(key: string, pull: PullData): Promise<void>;
  createJob(code: string, selection: Selection, demo: boolean): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  updateJob(id: string, patch: Partial<Job>): Promise<void>;
  activeJobs(): Promise<number>;
  close(): Promise<void>;
}
export class MemoryStore implements Store {
  reports = new Map<string, Report>();
  pulls = new Map<string, PullData>();
  jobs = new Map<string, Job>();
  async getReport(code: string) {
    return this.reports.get(code) ?? null;
  }
  async putReport(report: Report) {
    this.reports.set(report.code, report);
  }
  async getPull(key: string) {
    return this.pulls.get(key) ?? null;
  }
  async putPull(key: string, pull: PullData) {
    this.pulls.set(key, pull);
  }
  async createJob(reportCode: string, selection: Selection, demo: boolean) {
    for (const existing of this.jobs.values())
      if (expired(existing)) Object.assign(existing, expiry);
    if ([...this.jobs.values()].filter(active).length >= MAX_ACTIVE_JOBS)
      throw new QueueFullError();
    const job: Job = {
      id: randomUUID(),
      reportCode,
      selection,
      demo,
      status: 'queued',
      progress: 0,
      message: 'Queued for analysis',
      createdAt: new Date().toISOString(),
    };
    // No await between capacity check and insert: reserve in this event-loop turn.
    this.jobs.set(job.id, job);
    return job;
  }
  async getJob(id: string): Promise<Job | null> {
    const job = this.jobs.get(id);
    if (job && expired(job)) Object.assign(job, expiry);
    return job ?? null;
  }
  async updateJob(id: string, patch: Partial<Job>) {
    const job = this.jobs.get(id);
    if (job && active(job)) {
      const next = { ...patch };
      if (typeof next.progress === 'number' && next.progress < job.progress) {
        delete next.progress;
        delete next.message;
      }
      this.jobs.set(id, { ...job, ...next });
    }
  }
  async activeJobs() {
    for (const job of this.jobs.values()) if (expired(job)) Object.assign(job, expiry);
    return [...this.jobs.values()].filter(active).length;
  }
  async close() {}
}
export class PgStore implements Store {
  constructor(public pool: Pool) {}
  async init() {
    await this.pool
      .query(`CREATE TABLE IF NOT EXISTS reports(code text PRIMARY KEY, data jsonb NOT NULL, expires timestamptz NOT NULL);
      CREATE TABLE IF NOT EXISTS pulls(cache_key text PRIMARY KEY,data jsonb NOT NULL,expires timestamptz NOT NULL);
      CREATE TABLE IF NOT EXISTS analyses(id uuid PRIMARY KEY,data jsonb NOT NULL,created timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS analyses_created_idx ON analyses(created);`);
  }
  async getReport(code: string) {
    const r = await this.pool.query('SELECT data FROM reports WHERE code=$1 AND expires>now()', [
      code,
    ]);
    return (r.rows[0]?.data as Report) ?? null;
  }
  async putReport(report: Report) {
    await this.pool.query(
      `INSERT INTO reports VALUES($1,$2,now()+interval '5 minutes') ON CONFLICT(code) DO UPDATE SET data=excluded.data,expires=excluded.expires`,
      [report.code, JSON.stringify(report)],
    );
  }
  async getPull(key: string) {
    const r = await this.pool.query('SELECT data FROM pulls WHERE cache_key=$1 AND expires>now()', [
      key,
    ]);
    return (r.rows[0]?.data as PullData) ?? null;
  }
  async putPull(key: string, pull: PullData) {
    await this.pool.query(
      `INSERT INTO pulls VALUES($1,$2,now()+interval '7 days') ON CONFLICT(cache_key) DO UPDATE SET data=excluded.data,expires=excluded.expires`,
      [key, JSON.stringify(pull)],
    );
  }
  async createJob(reportCode: string, selection: Selection, demo: boolean) {
    const job: Job = {
      id: randomUUID(),
      reportCode,
      selection,
      demo,
      status: 'queued',
      progress: 0,
      message: 'Queued for analysis',
      createdAt: new Date().toISOString(),
    };
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      // Serialize only admission to this application's queue, across all API processes.
      await connection.query(
        "SELECT pg_advisory_xact_lock(hashtext('darkwhispers_app:analysis-admission'))",
      );
      const count = await connection.query(
        "SELECT count(*)::int AS n FROM analyses WHERE data->>'status' IN ('queued','running') AND created>now()-interval '2 hours'",
      );
      if (count.rows[0].n >= MAX_ACTIVE_JOBS) throw new QueueFullError();
      await connection.query('INSERT INTO analyses(id,data) VALUES($1,$2)', [
        job.id,
        JSON.stringify(job),
      ]);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
    return job;
  }
  async getJob(id: string): Promise<Job | null> {
    const r = await this.pool.query(
      "SELECT data FROM analyses WHERE id=$1 AND created>now()-interval '7 days'",
      [id],
    );
    const job = (r.rows[0]?.data as Job) ?? null;
    if (job && expired(job)) {
      const updated = await this.pool.query(
        "UPDATE analyses SET data=data||$2::jsonb WHERE id=$1 AND data->>'status' IN ('queued','running') AND created<=now()-interval '2 hours' RETURNING data",
        [id, JSON.stringify(expiry)],
      );
      if (updated.rows[0]) return updated.rows[0].data as Job;
      // A worker may have completed between the read and the conditional expiry.
      const current = await this.pool.query(
        "SELECT data FROM analyses WHERE id=$1 AND created>now()-interval '7 days'",
        [id],
      );
      return (current.rows[0]?.data as Job) ?? null;
    }
    return job;
  }
  async updateJob(id: string, patch: Partial<Job>) {
    await this.pool.query(
      `UPDATE analyses SET data=data||CASE
      WHEN $2::jsonb ? 'progress' AND ($2::jsonb->>'progress')::numeric < (data->>'progress')::numeric
      THEN $2::jsonb - 'progress' - 'message' ELSE $2::jsonb END WHERE id=$1 AND data->>'status' IN ('queued','running')`,
      [id, JSON.stringify(patch)],
    );
  }
  async activeJobs() {
    const r = await this.pool.query(
      "SELECT count(*)::int AS n FROM analyses WHERE data->>'status' IN ('queued','running') AND created>now()-interval '2 hours'",
    );
    return r.rows[0].n as number;
  }
  async cleanup() {
    await this.pool.query(
      "DELETE FROM reports WHERE expires<now(); DELETE FROM pulls WHERE expires<now(); DELETE FROM analyses WHERE created<now()-interval '7 days';",
    );
  }
  async close() {
    await this.pool.end();
  }
}
