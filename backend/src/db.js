import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export function connectDatabase(env = process.env) {
  const url = env.TURSO_DATABASE_URL || 'file:local.db';
  if ((env.NODE_ENV === 'production' || env.VERCEL) && (!url.startsWith('libsql://') || !env.TURSO_AUTH_TOKEN)) {
    throw new Error('Production requires TURSO_DATABASE_URL=libsql://… and TURSO_AUTH_TOKEN.');
  }
  const client = createClient({ url, authToken: env.TURSO_AUTH_TOKEN });
  return { client, db: drizzle(client, { schema }) };
}
