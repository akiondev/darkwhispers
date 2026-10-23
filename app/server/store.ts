import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Job, PullData, Report, Selection } from '../shared/types.js';
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
    this.jobs.set(job.id, job);
    return job;
  }
  async getJob(id: string) {
    return this.jobs.get(id) ?? null;
  }
  async updateJob(id: string, patch: Partial<Job>) {
    const job = this.jobs.get(id);
    if (job) this.jobs.set(id, { ...job, ...patch });
  }
  async activeJobs() {
    return [...this.jobs.values()].filter((j) => ['queued', 'running'].includes(j.status)).length;
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
    await this.pool.query('INSERT INTO analyses(id,data) VALUES($1,$2)', [
      job.id,
      JSON.stringify(job),
    ]);
    return job;
  }
  async getJob(id: string) {
    const r = await this.pool.query(
      "SELECT data FROM analyses WHERE id=$1 AND created>now()-interval '7 days'",
      [id],
    );
    return (r.rows[0]?.data as Job) ?? null;
  }
  async updateJob(id: string, patch: Partial<Job>) {
    await this.pool.query('UPDATE analyses SET data=data||$2::jsonb WHERE id=$1', [
      id,
      JSON.stringify(patch),
    ]);
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
