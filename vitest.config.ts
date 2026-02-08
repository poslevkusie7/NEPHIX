import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    clearMocks: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/web'),
      '@nephix/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@nephix/domain': path.resolve(__dirname, 'packages/domain/src/index.ts'),
      '@nephix/db': path.resolve(__dirname, 'packages/db/src/index.ts'),
      '@nephix/ui': path.resolve(__dirname, 'packages/ui/src/index.ts'),
    },
  },
});
