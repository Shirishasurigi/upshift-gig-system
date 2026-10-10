import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { pool } from './db.js';

async function main() {
  const { email, password, name } = config.seedAdmin;
  if (!email || password.length < 8) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 8 characters) in .env');
  }
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if ((existing as unknown[]).length > 0) {
    console.log('Admin already exists:', email);
  } else {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      "INSERT INTO users (email, display_name, password_hash, role) VALUES (?, ?, ?, 'admin')",
      [email, name, hash],
    );
    console.log('Admin created:', email);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});