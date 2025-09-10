// Shared test configuration and utilities for DB2 tests

// PIMS test database configuration
const PIMS_CONFIG = {
  hostname: 'mbgmvsc.pok.ibm.com',
  port: 3906,
  database: 'DB2C',
  uid: 'PRESS',
  pwd: 'VCKDTCW9',
  connectionTimeout: 15000,
  queryTimeout: 30000,
};

// Alternative connection config formats for compatibility
const PIMS_CONFIG_KNEX = {
  ...PIMS_CONFIG,
  user: PIMS_CONFIG.uid,
  password: PIMS_CONFIG.pwd,
};

// Test tablespace for DDL operations
const TEST_TABLESPACE = 'DSQDBDEF.DSQTSDEF';

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
  PIMS_CONFIG,
  PIMS_CONFIG_KNEX,
  TEST_TABLESPACE,
  POOL_CONFIG,
  shouldRunRealTests,
  skipIfNoRealDB,
  TEST_TIMEOUT,
};
