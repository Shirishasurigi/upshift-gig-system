import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../../db/migrations');

// Take only the "apply" part of a migration file
function getUpPart(sql: string): string {
  const upMarker = '-- migrate:up';
  const downMarker = '-- migrate:down';
  const start = sql.indexOf(upMarker);
  if (start === -1) throw new Error('Missing "-- migrate:up" marker');
  const end = sql.indexOf(downMarker);
  return sql.slice(start + upMarker.length, end === -1 ? undefined : end);
}

async function main() {
  const command = process.argv[2] ?? 'up';
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB
  `);

  const [rows] = await conn.query('SELECT filename FROM schema_migrations');
  const applied = new Set((rows as { filename: string }[]).map((r) => r.filename));
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  if (command === 'status') {
    for (const f of files) console.log(applied.has(f) ? '[applied] ' : '[pending] ', f);
    await conn.end();
    return;
  }

  for (const file of files) {
    if (applied.has(file)) continue;
    console.log('Applying', file, '...');
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    try {
      await conn.query(getUpPart(sql));
      await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log('  done');
    } catch (err) {
      console.error('FAILED on', file);
      console.error((err as Error).message);
      await conn.end();
      process.exit(1);
    }
  }

  console.log('All migrations are applied.');
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});