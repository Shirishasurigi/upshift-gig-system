import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from './db.js';
import { config } from './config.js';

export type Role = 'admin' | 'reviewer' | 'publisher';

// Use as a route guard: { preHandler: requireRole('admin', 'reviewer') }
export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify(); // reads the cookie
    } catch {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Please log in' } });
    }
    const user = request.user as { role: Role };
    if (roles.length > 0 && user.role !== 'admin' && !roles.includes(user.role)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Your role cannot do this' } });
    }
  };
}

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/v1/auth/login', async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Email and password are required' } });
    }
    const { email, password } = parsed.data;

    const [rows] = await pool.query(
      'SELECT id, email, display_name, password_hash, role, is_active FROM users WHERE email = ?',
      [email],
    );
    const user = (rows as any[])[0];

    // Same message for "no such user" and "wrong password" so attackers learn nothing
    const ok = user && user.is_active === 1 && (await bcrypt.compare(password, user.password_hash));
    if (!ok) {
      return reply.code(401).send({ error: { code: 'INVALID_LOGIN', message: 'Wrong email or password' } });
    }

    const token = app.jwt.sign(
      { sub: String(user.id), role: user.role, name: user.display_name },
      { expiresIn: `${config.sessionMinutes}m` },
    );
    await pool.query('UPDATE users SET last_login_at = NOW(3) WHERE id = ?', [user.id]);

    reply.setCookie('token', token, {
      httpOnly: true,        // JavaScript in the browser cannot read it
      sameSite: 'lax',
      path: '/',
      maxAge: config.sessionMinutes * 60,
    });
    return { id: user.id, email: user.email, name: user.display_name, role: user.role };
  });

  app.post('/api/v1/auth/logout', async (_request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return { ok: true };
  });

  app.get('/api/v1/auth/me', { preHandler: requireRole() }, async (request) => {
    const u = request.user as { sub: string; role: Role; name: string };
    return { id: Number(u.sub), role: u.role, name: u.name };
  });
}