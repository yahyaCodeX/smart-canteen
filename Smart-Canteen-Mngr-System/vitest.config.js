// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.js'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
    },
  },
});
