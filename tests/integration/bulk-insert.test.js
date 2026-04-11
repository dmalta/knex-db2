// Integration tests for the ibm_db column-wise ARRAY bulk insert fast path (Phase 3).
// Requires DB2_REAL_TEST=true and a live IBM DB2 z/OS connection to run.
const knex = require('knex');
const Db2Client = require('../../src/client');
const { DB_CONFIG, POOL_CONFIG, shouldRunRealTests, TEST_TIMEOUT, TEST_TABLESPACE } = require('../helpers/test-config');

const runTests = shouldRunRealTests();

const ts = Date.now();
const BULK_TABLE = `KNEX_IT_BULK_${ts}`;

(runTests ? describe : describe.skip)('DB2 Bulk Insert Integration Tests', () => {
  let db;

  beforeAll(async () => {
    db = knex({
      client: Db2Client,
      connection: DB_CONFIG,
      pool: POOL_CONFIG,
    });

    await db.raw(
      `CREATE TABLE ${BULK_TABLE} (id INTEGER NOT NULL, name VARCHAR(50), amount DECIMAL(10,2)) IN ${TEST_TABLESPACE}`
    );
  }, TEST_TIMEOUT * 2);

  afterAll(async () => {
    if (db) {
      try { await db.schema.dropTableIfExists(BULK_TABLE); } catch (e) { console.warn('Cleanup warning:', e.message); }
      await db.destroy();
    }
  }, TEST_TIMEOUT);

  afterEach(async () => {
    await db(BULK_TABLE).delete();
  }, TEST_TIMEOUT);

  test('multi-row insert uses fast path and persists all rows', async () => {
    await db(BULK_TABLE).insert([
      { id: 1, name: 'Alice', amount: 10.00 },
      { id: 2, name: 'Bob',   amount: 20.00 },
      { id: 3, name: 'Carol', amount: 30.00 },
    ]);

    const rows = await db(BULK_TABLE).orderBy('id');
    expect(rows).toHaveLength(3);

    const names = rows.map((r) => r.NAME || r.name);
    expect(names).toEqual(['Alice', 'Bob', 'Carol']);

    const amounts = rows.map((r) => parseFloat(r.AMOUNT || r.amount));
    expect(amounts).toEqual([10.00, 20.00, 30.00]);
  }, TEST_TIMEOUT);

  test('single-row insert still works (serial path)', async () => {
    await db(BULK_TABLE).insert({ id: 10, name: 'Solo', amount: 99.99 });

    const rows = await db(BULK_TABLE).where({ id: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0].NAME || rows[0].name).toBe('Solo');
  }, TEST_TIMEOUT);

  test('bulk insert row count matches number of rows provided', async () => {
    const payload = Array.from({ length: 10 }, (_, i) => ({
      id: 100 + i,
      name: `User${i}`,
      amount: i * 5,
    }));

    await db(BULK_TABLE).insert(payload);

    const [{ CNT }] = await db(BULK_TABLE).count('id as CNT');
    expect(Number(CNT)).toBe(10);
  }, TEST_TIMEOUT);

  test('bulk insert preserves column values accurately', async () => {
    await db(BULK_TABLE).insert([
      { id: 200, name: 'Exact', amount: 123.45 },
      { id: 201, name: 'Check', amount: 678.90 },
    ]);

    const rows = await db(BULK_TABLE).whereIn('id', [200, 201]).orderBy('id');
    expect(rows).toHaveLength(2);
    expect(parseFloat(rows[0].AMOUNT || rows[0].amount)).toBeCloseTo(123.45, 2);
    expect(parseFloat(rows[1].AMOUNT || rows[1].amount)).toBeCloseTo(678.90, 2);
    expect(rows[0].NAME || rows[0].name).toBe('Exact');
    expect(rows[1].NAME || rows[1].name).toBe('Check');
  }, TEST_TIMEOUT);

  test('bulk insert inside a transaction commits all rows atomically', async () => {
    await db.transaction(async (trx) => {
      await trx(BULK_TABLE).insert([
        { id: 300, name: 'TxA', amount: 1 },
        { id: 301, name: 'TxB', amount: 2 },
      ]);
    });

    const rows = await db(BULK_TABLE).whereIn('id', [300, 301]).orderBy('id');
    expect(rows).toHaveLength(2);
  }, TEST_TIMEOUT * 2);

  test('bulk insert inside a rolled-back transaction inserts no rows', async () => {
    try {
      await db.transaction(async (trx) => {
        await trx(BULK_TABLE).insert([
          { id: 400, name: 'RxA', amount: 1 },
          { id: 401, name: 'RxB', amount: 2 },
        ]);
        await trx.rollback();
      });
    } catch (_e) {
      // Expected — rollback causes rejection
    }

    const rows = await db(BULK_TABLE).whereIn('id', [400, 401]);
    expect(rows).toHaveLength(0);
  }, TEST_TIMEOUT * 2);
});
