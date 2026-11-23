import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The link build. base './' so it works from any sub-folder (…/one-night/junior/).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2022', outDir: 'dist', chunkSizeWarningLimit: 4000 },
  worker: { format: 'iife' },
});
