import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built site works from any sub-path (GitHub Pages) and from disk.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'iife' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
  },
  server: { port: 5173, strictPort: true },
})
