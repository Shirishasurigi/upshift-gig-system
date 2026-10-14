import bcrypt from 'bcryptjs';
import { pool } from './db.js';

// Usage: npm run create:user -w apps/api -- reviewer1@example.com Passw0rd123 reviewer "Rita Reviewer"
async function main() {
  const [email, password, role, name] = process.argv.slice(2);
  if (!email || !password || !['admin', 'reviewer', 'publisher'].includes(role ?? '')) {
    throw new Error('Usage: npm run create:user -w apps/api -- <email> <password> <admin|reviewer|publisher> "<Display Name>"');
  }
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const [exists] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if ((exists as unknown[]).length) { console.log('User already exists:', email); await pool.end(); return; }
  await pool.query('INSERT INTO users (email, display_name, password_hash, role) VALUES (?, ?, ?, ?)',
    [email, name || email.split('@')[0], await bcrypt.hash(password, 12), role]);
  console.log(`Created ${role}: ${email}`);
  await pool.end();
}
main().catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
