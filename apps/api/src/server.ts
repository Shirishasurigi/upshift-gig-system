import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { config } from './config.js';
import { pool } from './db.js';
import { authRoutes } from './auth.js';
import { discoveryRoutes } from './discoveryRoutes.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: config.corsOrigins, credentials: true });
await app.register(cookie);
await app.register(jwt, { secret: config.jwtSecret, cookie: { cookieName: 'token', signed: false } });

app.get('/health', async () => {
  const [rows] = await pool.query('SELECT VERSION() AS version');
  return { status: 'ok', mysql: (rows as any)[0].version };
});

await app.register(authRoutes);
await app.register(discoveryRoutes);

await app.listen({ host: config.host, port: config.port });
