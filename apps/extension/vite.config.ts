import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolveFromPackage = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // public/ holds manifest.json, which Vite copies verbatim into dist/.
  publicDir: 'public',
  resolve: {
    alias: {
      '@desaignsync/core': resolveFromPackage('../../packages/core/src/index.ts'),
      '@desaignsync/shared-types': resolveFromPackage('../../packages/shared-types/src/index.ts')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        sidepanel: resolveFromPackage('sidepanel.html'),
        'service-worker': resolveFromPackage('src/background/service-worker.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
});