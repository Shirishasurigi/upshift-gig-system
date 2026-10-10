import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const jwtSecret = process.env.JWT_SECRET ?? '';
if (jwtSecret.length < 16) {
  throw new Error('JWT_SECRET is missing or too short (min 16 characters). Set it in .env');
}

export const config = {
  host: process.env.API_HOST ?? '0.0.0.0',
  port: Number(process.env.API_PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
  jwtSecret,
  sessionMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 480),
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? '',
  },
  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL ?? '',
    password: process.env.SEED_ADMIN_PASSWORD ?? '',
    name: process.env.SEED_ADMIN_NAME ?? 'Admin',
  },
};