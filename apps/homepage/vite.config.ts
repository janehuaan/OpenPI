import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 3333,
    host: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
