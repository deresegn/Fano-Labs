import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import monaco from 'vite-plugin-monaco-editor';
import path from 'path';

export default defineConfig({
  root: './frontend',
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './frontend/src'),
      '@/shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco-editor': ['monaco-editor']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['monaco-editor']
  }
}); 