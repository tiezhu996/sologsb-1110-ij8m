import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 21810, host: true },
  preview: { port: 21810, host: true },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
