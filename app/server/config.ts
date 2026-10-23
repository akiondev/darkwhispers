import { VERSION } from '../shared/version.js';
export const config = {
  version: VERSION,
  port: Number(process.env.PORT ?? 8879),
  host: '127.0.0.1',
  production: process.env.NODE_ENV === 'production',
  database: {
    host: process.env.PGHOST ?? '/var/run/postgresql',
    database: process.env.PGDATABASE ?? 'darkwhispers_app',
    user: process.env.PGUSER ?? 'darkwhispers_app',
    max: 4,
  },
  clientId: process.env.WCL_CLIENT_ID ?? '',
  clientSecret: process.env.WCL_CLIENT_SECRET ?? '',
  maxPulls: 150,
  cacheDays: 7,
};
