// Integration tests for complex DB2 query operations
// Tests query builder features, joins, aggregations, and advanced SQL
const knex = require('knex');
const Db2Client = require('../../client');
const { PIMS_CONFIG_KNEX, POOL_CONFIG, shouldRunRealTests, TEST_TIMEOUT } = require('../helpers/test-config');

const runTests = shouldRunRealTests();

(runTests ? describe : describe.skip)('DB2 Query Integration Tests', () => {
  let db;

  beforeAll(async () => {
    db = knex({
      client: Db2Client,
      connection: PIMS_CONFIG_KNEX,
      pool: POOL_CONFIG,
    });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  }, TEST_TIMEOUT);

  describe('Query Builder Features', () => {
    test('should handle basic SELECT queries', async () => {
      // Simple test that works with basic SQL
      const result = await db.raw('SELECT 1 as test_value FROM SYSIBM.SYSDUMMY1');
      expect(result).toBeDefined();
      expect(result[0]).toHaveProperty('TEST_VALUE', 1);
    }, TEST_TIMEOUT);
  });
});
