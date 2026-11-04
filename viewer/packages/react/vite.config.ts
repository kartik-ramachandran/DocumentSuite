import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.tsx', formats: ['es'], fileName: 'index' },
    target: 'es2022',
    rollupOptions: { external: ['react', 'react/jsx-runtime', '@document-suite/viewer'] },
  },
});
