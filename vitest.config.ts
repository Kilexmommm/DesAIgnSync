import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolveFromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@desaignsync/shared-types': resolveFromRoot('packages/shared-types/src/index.ts'),
      '@desaignsync/core': resolveFromRoot('packages/core/src/index.ts'),
      '@desaignsync/mcp-adapters': resolveFromRoot('packages/mcp-adapters/src/index.ts'),
      '@desaignsync/local-host': resolveFromRoot('apps/local-host/src/index.ts')
    }
  },
  test: {
    environment: 'node',
    include: [
      'apps/**/*.test.ts',
      'packages/**/*.test.ts',
      'tests/**/*.test.ts'
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.tsbuild/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    restoreMocks: true
  }
});