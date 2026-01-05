import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Standalone test scripts that use bun/node test runner, not vitest
      'workers/text-gen/src/utils/json-validator.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@infrastructure': path.resolve(__dirname, './infrastructure'),
      '@workers': path.resolve(__dirname, './workers'),
      '@shared': path.resolve(__dirname, './workers/shared'),
      // Required: Mock cloudflare:workers for testing (do not remove)
      'cloudflare:workers': path.resolve(__dirname, './tests/__mocks__/cloudflare-workers.ts'),
    },
  },
});
