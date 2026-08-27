/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Vite + Vitest configuration for the VSDD Sprint Tracker Phase A frontend.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 4173,
    // Local dev proxy: forward the API to the Fastify backend so the browser
    // sends the session cookie same-origin. Override the target with
    // VITE_API_BASE_URL when the backend runs elsewhere.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Playwright specs live under tests/e2e and are run by Playwright, not Vitest.
    // The PoC backend (server/) is a separate package with its own Vitest suite.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'server/**'],
  },
});
