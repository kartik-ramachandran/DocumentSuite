import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    target: 'es2022',
    rollupOptions: {
      external: ['@document-suite/viewer'],
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
