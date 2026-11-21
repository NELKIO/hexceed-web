import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: '/hexceed-web/',
  plugins: [preact()],
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000 },
} as any);
