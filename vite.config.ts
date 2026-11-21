import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    port: 5180,
    fs: { allow: [path.resolve(__dirname)] },
    proxy: { '/api': { target: 'http://localhost:4700', changeOrigin: true } },
  },
});
