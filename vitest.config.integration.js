const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.test.js'],
    testTimeout: 60000,
    hookTimeout: 60000,
    env: {
      DB2_REAL_TEST: 'true',
    },
  },
});
