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
const TEST_TABLESPACE = dbConfig.tablespace;

// Pool configuration for integration tests
const POOL_CONFIG = {
  min: 1,
  max: 3,
  acquireTimeoutMillis: 5000,
  createTimeoutMillis: 5000,
  destroyTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
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

/**
 * Drop all KNEX_IT_% tables owned by the current DB2 user.
 * Call this at the top of beforeAll to sweep up tables left behind by
 * previous test runs that were interrupted or whose afterAll failed.
 */
async function cleanupDanglingTestTables(db) {
  try {
    const rows = await db.raw(
      `SELECT NAME FROM SYSIBM.SYSTABLES WHERE NAME LIKE 'KNEX_IT_%' AND CREATOR = USER AND TYPE = 'T'`
    );
    for (const row of rows) {
      const name = row.NAME || row.name;
      try {
        await db.schema.dropTable(name);
      } catch (e) {
        console.warn(`Pre-test cleanup: could not drop ${name}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn('Pre-test cleanup catalog query failed:', e.message);
  }
}

module.exports = {
  DB_CONFIG,
  TEST_TABLESPACE,
  POOL_CONFIG,
  shouldRunRealTests,
  skipIfNoRealDB,
  TEST_TIMEOUT,
  cleanupDanglingTestTables,
};
