import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

// The API and website share the development .env at the repository root.
// Only server-side code reads these values; do not prefix secrets with NEXT_PUBLIC_.
dotenv.config({ path: path.resolve(here, '../../.env') });

const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
