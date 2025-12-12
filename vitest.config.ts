import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
    },
  },
});
