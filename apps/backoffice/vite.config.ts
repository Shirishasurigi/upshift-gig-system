/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, the browser talks to this dev server and it forwards /api to the Fastify API.
// That keeps login cookies simple (same address) and avoids cross-site problems.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts', globals: true },
});
