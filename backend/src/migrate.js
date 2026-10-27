import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { connectDatabase } from './db.js';

export async function migrateDatabase(db) {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { client, db } = connectDatabase();
  try {
    await migrateDatabase(db);
    console.log('Database migrations complete.');
  } finally { client.close(); }
}
