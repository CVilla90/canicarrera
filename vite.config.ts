import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('./client'),
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@shared': here('./shared'),
      '@client': here('./client'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true },
    },
  },
  build: {
    outDir: here('./dist/client'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // three.js is the biggest thing in the bundle and never changes between
        // deploys — its own chunk stays cached while the app iterates.
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
