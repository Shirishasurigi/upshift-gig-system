import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { pool } from './db.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: config.corsOrigins, credentials: true });

app.get('/health', async () => {
  const [rows] = await pool.query('SELECT VERSION() AS version');
  return { status: 'ok', mysql: (rows as any)[0].version };
});

await app.listen({ host: config.host, port: config.port });