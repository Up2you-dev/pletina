import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.js', 'src/main/library.js', 'src/main/store.js'],
    },
  },
});
