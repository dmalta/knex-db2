// Integration tests for DB2 connection management and basic operations
// These tests require a real DB2 connection when DB2_REAL_TEST=true
const knex = require('knex');
const Db2Client = require('../../client');
const { PIMS_CONFIG_KNEX, POOL_CONFIG, shouldRunRealTests, TEST_TIMEOUT } = require('../helpers/test-config');

const runTests = shouldRunRealTests();

(runTests ? describe : describe.skip)('DB2 Connection Integration Tests', () => {
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

  describe('Connection Management', () => {
    test('should connect to PIMS DB2 database', async () => {
      const result = await db.raw('SELECT 1 as test_value FROM SYSIBM.SYSDUMMY1');
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('TEST_VALUE', 1);
    }, TEST_TIMEOUT);

    test('should handle connection pool properly', async () => {
      // Execute multiple queries concurrently to test pool
      const queries = Array.from({ length: 3 }, (_, i) =>
        db.raw('SELECT ? as query_num FROM SYSIBM.SYSDUMMY1', [i + 1])
      );

      const results = await Promise.all(queries);
      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result[0]).toHaveProperty('QUERY_NUM', index + 1);
      });
    }, TEST_TIMEOUT);
  });

  describe('Basic Query Operations', () => {
    test('should execute simple SELECT query', async () => {
      const result = await db.raw("SELECT 'Hello DB2' as greeting FROM SYSIBM.SYSDUMMY1");
      expect(result).toBeDefined();
      expect(result[0]).toHaveProperty('GREETING', 'Hello DB2');
    }, TEST_TIMEOUT);

    test('should handle date and timestamp queries', async () => {
      const result = await db.raw(`
        SELECT 
          CURRENT DATE as current_date,
          CURRENT TIME as current_time,
          CURRENT TIMESTAMP as current_timestamp
        FROM SYSIBM.SYSDUMMY1
      `);

      expect(result[0]).toHaveProperty('CURRENT_DATE');
      expect(result[0]).toHaveProperty('CURRENT_TIME');
      expect(result[0]).toHaveProperty('CURRENT_TIMESTAMP');
    }, TEST_TIMEOUT);
  });

  describe('Error Handling', () => {
    test('should handle SQL syntax errors', async () => {
      await expect(db.raw('SELCT * FROM INVALID_SYNTAX')).rejects.toThrow();
    }, TEST_TIMEOUT);

    test('should handle table not found errors', async () => {
      await expect(db.raw('SELECT * FROM NON_EXISTENT_TABLE_12345')).rejects.toThrow();
    }, TEST_TIMEOUT);
  });
});
