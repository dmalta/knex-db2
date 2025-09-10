// Shared test configuration and utilities for DB2 tests

// Load DB2 config from JSON file
let dbConfig;
try {
  dbConfig = require('../integration/db2-config.json');
} catch {
  // Fallback to example config if the real config doesn't exist
  console.warn('db2-config.json not found, using example config. Copy db2-config-example.json to db2-config.json and update with real credentials.');
  dbConfig = require('../integration/db2-config-example.json');
}

// DB2 test database configuration
const DB_CONFIG = {
  ...dbConfig,
  connectionTimeout: 15000,
  queryTimeout: 30000,
};

// Test tablespace for DDL operations
const TEST_TABLESPACE = dbConfig.schema;

// Pool configuration for integration tests
const POOL_CONFIG = {
  min: 1,
  max: 3,
  acquireTimeoutMillis: 15000,
  createTimeoutMillis: 15000,
  destroyTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
};

// Environment check for real DB2 tests
const shouldRunRealTests = () => process.env.DB2_REAL_TEST === 'true';

// Skip test helper
const skipIfNoRealDB = (testName) => {
  if (!shouldRunRealTests()) {
    console.log(`Skipping ${testName} - set DB2_REAL_TEST=true to enable`);
    return true;
  }
  return false;
};

// Common test timeout
const TEST_TIMEOUT = 30000;

module.exports = {
  DB_CONFIG,
  TEST_TABLESPACE,
  POOL_CONFIG,
  shouldRunRealTests,
  skipIfNoRealDB,
  TEST_TIMEOUT,
};
