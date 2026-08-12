import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@msgflow/config': path.resolve(__dirname, 'packages/config/src/index.ts'),
      '@msgflow/logger': path.resolve(__dirname, 'packages/logger/src/index.ts'),
      '@msgflow/types': path.resolve(__dirname, 'packages/types/src/index.ts'),
      '@msgflow/validation': path.resolve(__dirname, 'packages/validation/src/index.ts'),
      '@msgflow/db': path.resolve(__dirname, 'packages/db/src/index.ts'),
      '@msgflow/ai': path.resolve(__dirname, 'packages/ai/src/index.ts'),
      '@msgflow/connectors': path.resolve(__dirname, 'packages/connectors/src/index.ts'),
      '@msgflow/workflow': path.resolve(__dirname, 'packages/workflow/src/index.ts'),
    },
  },
});
