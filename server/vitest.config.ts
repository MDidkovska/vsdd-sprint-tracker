import { defineConfig } from 'vitest/config';

// Vitest configuration for the PoC backend.
//
// Integration tests spin up an ephemeral MongoDB via mongodb-memory-server.
// The first run may download a mongod binary, so hooks get a generous timeout.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Integration tests share an ephemeral Mongo per file; keep them serial and
    // isolated so an in-memory server is never shared across worker processes.
    fileParallelism: false,
  },
});
