const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    exclude: ['tests/helpers/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['tests/**'],
      reportsDirectory: 'coverage',
      reporter: ['text', 'lcov', 'html'],
    },
  },
});
