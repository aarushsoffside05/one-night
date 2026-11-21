import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { renameSync, existsSync } from 'node:fs';

// The single self-contained HTML file: single/one-night-junior.html
export default defineConfig({
  base: './',
  plugins: [
    react(),
    viteSingleFile({ removeViteModuleLoader: true }),
    {
      name: 'rename-single',
      closeBundle() {
        if (existsSync('single/index.html')) renameSync('single/index.html', 'single/one-night-junior.html');
      },
    },
  ],
  build: { target: 'es2022', outDir: 'single', chunkSizeWarningLimit: 8000, assetsInlineLimit: 100000000 },
  worker: { format: 'iife' },
});
