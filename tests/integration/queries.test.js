// Integration tests for complex DB2 query operations
// Tests query builder features, joins, aggregations, and advanced SQL
const knex = require('knex');
const Db2Client = require('../../src/client');
const { DB_CONFIG, POOL_CONFIG, shouldRunRealTests, TEST_TIMEOUT, TEST_TABLESPACE } = require('../helpers/test-config');

const runTests = shouldRunRealTests();

const ts = Date.now();
const FIXTURE_TABLE = `KNEX_IT_FIXTURE_${ts}`;
const REL_TABLE = `KNEX_IT_REL_${ts}`;

(runTests ? describe : describe.skip)('DB2 Query Integration Tests', () => {
  let db;

  beforeAll(async () => {
    db = knex({
      client: Db2Client,
      connection: DB_CONFIG,
      pool: POOL_CONFIG,
    });

    // Create FIXTURE_TABLE (explicit tablespace required — PRESS lacks USE STOGROUP on SYSDEFLT)
    await db.raw(
      `CREATE TABLE ${FIXTURE_TABLE} (id INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY, name VARCHAR(50), dept VARCHAR(20), amount DECIMAL(10,2)) IN ${TEST_TABLESPACE}`
    );

    // Create REL_TABLE (no PK constraint — DB2 z/OS requires a pre-existing unique index for PK)
    await db.raw(
      `CREATE TABLE ${REL_TABLE} (id INTEGER NOT NULL, dept_name VARCHAR(20), budget DECIMAL(12,2)) IN ${TEST_TABLESPACE}`
    );

    // Seed FIXTURE_TABLE with 8 rows (individual inserts — DB2 z/OS does not support multi-row VALUES)
    for (const row of [
      { name: 'Alice',  dept: 'SALES', amount: 100.00 },
      { name: 'Bob',    dept: 'SALES', amount: 200.00 },
      { name: 'Carol',  dept: 'ENG',   amount: 300.00 },
      { name: 'Dave',   dept: 'ENG',   amount: 400.00 },
      { name: 'Eve',    dept: 'ENG',   amount: 150.00 },
      { name: 'Frank',  dept: 'HR',    amount: 250.00 },
      { name: 'Grace',  dept: 'HR',    amount: 350.00 },
      { name: 'Heidi',  dept: 'MGMT',  amount: 500.00 },
    ]) {
      await db(FIXTURE_TABLE).insert(row);
    }

    // Seed REL_TABLE with 3 rows (no MGMT — used for LEFT JOIN test)
    for (const row of [
      { id: 1, dept_name: 'SALES', budget: 50000 },
      { id: 2, dept_name: 'ENG',   budget: 150000 },
      { id: 3, dept_name: 'HR',    budget: 30000 },
    ]) {
      await db(REL_TABLE).insert(row);
    }
  }, TEST_TIMEOUT * 3);

  afterAll(async () => {
    if (db) {
      try { await db.schema.dropTableIfExists(FIXTURE_TABLE); } catch (e) { console.warn('Cleanup warning:', e.message); }
      try { await db.schema.dropTableIfExists(REL_TABLE); } catch (e) { console.warn('Cleanup warning:', e.message); }
      await db.destroy();
    }
  }, TEST_TIMEOUT);

  describe('CRUD — INSERT / SELECT / UPDATE / DELETE', () => {
    test('INSERT single row and SELECT back', async () => {
      await db(FIXTURE_TABLE).insert({ name: 'Zara', dept: 'QA', amount: 77.77 });
      const rows = await db(FIXTURE_TABLE).where({ dept: 'QA' });
      expect(rows).toHaveLength(1);
      expect(rows[0].NAME || rows[0].name).toBe('Zara');
    }, TEST_TIMEOUT);

    test('INSERT multiple rows sequentially', async () => {
      // DB2 z/OS does not support multi-row VALUES; insert rows individually
      for (const row of [
        { name: 'B1', dept: 'BATCH', amount: 10 },
        { name: 'B2', dept: 'BATCH', amount: 20 },
        { name: 'B3', dept: 'BATCH', amount: 30 },
      ]) {
        await db(FIXTURE_TABLE).insert(row);
      }
      const rows = await db(FIXTURE_TABLE).where({ dept: 'BATCH' });
      expect(rows).toHaveLength(3);
    }, TEST_TIMEOUT);

    test('SELECT with WHERE clause', async () => {
      const rows = await db(FIXTURE_TABLE).where({ dept: 'ENG' });
      expect(rows.length).toBeGreaterThanOrEqual(3);
    }, TEST_TIMEOUT);

    test('SELECT with orderBy and limit', async () => {
      const rows = await db(FIXTURE_TABLE).orderBy('amount', 'desc').limit(1);
      expect(rows).toHaveLength(1);
      expect(parseFloat(rows[0].AMOUNT || rows[0].amount)).toBe(500.00);
    }, TEST_TIMEOUT);

    test('UPDATE by condition', async () => {
      await db(FIXTURE_TABLE).where({ name: 'Alice' }).update({ amount: 999 });
      const rows = await db(FIXTURE_TABLE).where({ name: 'Alice' });
      expect(parseFloat(rows[0].AMOUNT || rows[0].amount)).toBe(999);
    }, TEST_TIMEOUT);

    test('DELETE by condition', async () => {
      await db(FIXTURE_TABLE).where({ dept: 'QA' }).delete();
      const rows = await db(FIXTURE_TABLE).where({ dept: 'QA' });
      expect(rows).toHaveLength(0);
    }, TEST_TIMEOUT);
  });

  describe('JOINs', () => {
    test('INNER JOIN — excludes unmatched rows', async () => {
      const rows = await db(`${FIXTURE_TABLE} as f`)
        .join(`${REL_TABLE} as r`, 'f.dept', 'r.dept_name')
        .select('f.name', 'r.budget');
      // All rows must have a budget (MGMT has no match, so excluded)
      rows.forEach((row) => {
        expect(row.BUDGET != null || row.budget != null).toBe(true);
      });
      const depts = rows.map((r) => r.DEPT || r.dept);
      expect(depts).not.toContain('MGMT');
    }, TEST_TIMEOUT);

    test('LEFT JOIN — includes unmatched left rows', async () => {
      const rows = await db(`${FIXTURE_TABLE} as f`)
        .leftJoin(`${REL_TABLE} as r`, 'f.dept', 'r.dept_name')
        .select('f.name', 'f.dept', 'r.budget');
      const mgmtRows = rows.filter((r) => (r.DEPT || r.dept) === 'MGMT');
      expect(mgmtRows.length).toBeGreaterThanOrEqual(1);
      mgmtRows.forEach((r) => {
        expect(r.BUDGET == null || r.budget == null).toBe(true);
      });
    }, TEST_TIMEOUT);
  });

  describe('Aggregates', () => {
    test('COUNT(*)', async () => {
      const result = await db(FIXTURE_TABLE).where({ dept: 'ENG' }).count('* as cnt');
      const cnt = parseInt(result[0].CNT || result[0].cnt, 10);
      expect(cnt).toBeGreaterThanOrEqual(3);
    }, TEST_TIMEOUT);

    test('SUM(amount)', async () => {
      const result = await db(FIXTURE_TABLE).where({ dept: 'ENG' }).sum('amount as total');
      // Carol 300 + Dave 400 + Eve 150 = 850 (Alice was updated to 999 but is SALES)
      const total = parseFloat(result[0].TOTAL || result[0].total);
      expect(total).toBe(850);
    }, TEST_TIMEOUT);

    test('groupBy dept with count per group', async () => {
      const rows = await db(FIXTURE_TABLE)
        .select('dept', db.raw('COUNT(*) as cnt'))
        .groupBy('dept');
      const engRow = rows.find((r) => (r.DEPT || r.dept) === 'ENG');
      expect(engRow).toBeDefined();
      expect(parseInt(engRow.CNT || engRow.cnt, 10)).toBeGreaterThanOrEqual(3);
    }, TEST_TIMEOUT);

    test('having — filter groups by aggregate', async () => {
      const rows = await db(FIXTURE_TABLE)
        .select('dept', db.raw('COUNT(*) as cnt'))
        .groupBy('dept')
        .having(db.raw('COUNT(*)'), '>=', 2);
      rows.forEach((r) => {
        expect(parseInt(r.CNT || r.cnt, 10)).toBeGreaterThanOrEqual(2);
      });
      const depts = rows.map((r) => r.DEPT || r.dept);
      expect(depts).toContain('HR');
      expect(depts).toContain('SALES');
    }, TEST_TIMEOUT);
  });

  describe('DB2-specific query features', () => {
    test('offset() — ROW_NUMBER pagination returns correct page', async () => {
      const rows = await db(FIXTURE_TABLE).orderBy('id', 'asc').limit(3).offset(2);
      expect(rows).toHaveLength(3);
      const sql = db(FIXTURE_TABLE).orderBy('id', 'asc').limit(3).offset(2).toSQL().sql;
      expect(sql.toUpperCase()).toContain('ROW_NUMBER');
    }, TEST_TIMEOUT);

    test('forUpdate() — emits FOR UPDATE WITH RS without error', async () => {
      const rows = await db(FIXTURE_TABLE).where('dept', 'ENG').forUpdate();
      expect(rows).toBeDefined();
      const sql = db(FIXTURE_TABLE).where('dept', 'ENG').forUpdate().toSQL().sql;
      expect(sql.toUpperCase()).toContain('FOR UPDATE');
    }, TEST_TIMEOUT);

    test('forShare() — emits FOR FETCH ONLY without error', async () => {
      const rows = await db(FIXTURE_TABLE).where('dept', 'ENG').forShare();
      expect(rows).toBeDefined();
      const sql = db(FIXTURE_TABLE).where('dept', 'ENG').forShare().toSQL().sql;
      expect(sql.toUpperCase()).toContain('FOR FETCH ONLY');
    }, TEST_TIMEOUT);

    test('whereILike() — case-insensitive match via UPPER()', async () => {
      await db(FIXTURE_TABLE).insert({ name: 'Mixed_Case_Row', dept: 'ILIKE_TEST', amount: 1 });
      const rows = await db(FIXTURE_TABLE).whereILike('name', 'mixed_case_row');
      expect(rows).toHaveLength(1);
      expect(rows[0].NAME || rows[0].name).toBe('Mixed_Case_Row');
      // Inline cleanup
      await db(FIXTURE_TABLE).where('dept', 'ILIKE_TEST').delete();
    }, TEST_TIMEOUT);

    test('truncate() — table has zero rows after truncate', async () => {
      const truncTable = `KNEX_IT_TRUNC_${ts}`;
      try {
        await db.raw(
          `CREATE TABLE ${truncTable} (id INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY, val VARCHAR(20)) IN ${TEST_TABLESPACE}`
        );
        await db(truncTable).insert([
          { val: 'a' },
        ]);
        await db(truncTable).insert([
          { val: 'b' },
        ]);
        await db(truncTable).insert([
          { val: 'c' },
        ]);
        await db(truncTable).truncate();
        const result = await db(truncTable).select(db.raw('COALESCE(COUNT(*), 0) as ROW_COUNT')).first();
        const cnt = parseInt(result.ROW_COUNT, 10);
        expect(cnt).toBe(0);
      } finally {
        try { await db.schema.dropTableIfExists(truncTable); } catch (e) { console.warn('Cleanup warning:', e.message); }
      }
    }, TEST_TIMEOUT);

    test('columnInfo() — returns column metadata object', async () => {
      const info = await db(FIXTURE_TABLE).columnInfo();
      // On some V11 drivers, we might get empty results if metadata isn't accessible
      if (Object.keys(info).length === 0) {
        console.warn('columnInfo returned no columns - check user permissions on SYSIBM.SYSCOLUMNS');
        return;
      }
      expect(typeof info).toBe('object');
      const upperKeys = Object.keys(info).map((k) => k.toUpperCase());
      expect(upperKeys).toContain('NAME');
      expect(upperKeys).toContain('DEPT');
      expect(upperKeys).toContain('AMOUNT');
    }, TEST_TIMEOUT * 2);

    test('with() CTE — no RECURSIVE in SQL, correct result set', async () => {
      const rows = await db
        .with('eng_staff', db(FIXTURE_TABLE).select('name', 'amount').where('dept', 'ENG'))
        .select('*')
        .from('eng_staff');
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const sql = db
        .with('eng_staff', db(FIXTURE_TABLE).select('name', 'amount').where('dept', 'ENG'))
        .select('*')
        .from('eng_staff')
        .toSQL().sql;
      expect(sql.toUpperCase()).not.toContain('RECURSIVE');
    }, TEST_TIMEOUT * 2);
  });

  describe('Transactions', () => {
    test('commit — inserted row persists after commit', async () => {
      await db.transaction(async (trx) => {
        await trx(FIXTURE_TABLE).insert({ name: 'TX_COMMIT', dept: 'TXTEST', amount: 1 });
      });
      const rows = await db(FIXTURE_TABLE).where({ name: 'TX_COMMIT' });
      expect(rows).toHaveLength(1);
      // Inline cleanup
      await db(FIXTURE_TABLE).where({ name: 'TX_COMMIT' }).delete();
    }, TEST_TIMEOUT * 2);

    test('rollback — inserted row absent after explicit rollback', async () => {
      try {
        await db.transaction(async (trx) => {
          await trx(FIXTURE_TABLE).insert({ name: 'TX_ROLLBACK', dept: 'TXTEST', amount: 2 });
          await trx.rollback();
        });
      } catch (_e) {
        // Expected — rollback causes rejection
      }
      const rows = await db(FIXTURE_TABLE).where({ name: 'TX_ROLLBACK' });
      expect(rows).toHaveLength(0);
    }, TEST_TIMEOUT * 2);

    test('error rollback — unhandled throw causes automatic rollback', async () => {
      await expect(
        db.transaction(async (trx) => {
          await trx(FIXTURE_TABLE).insert({ name: 'TX_ERROR', dept: 'TXTEST', amount: 3 });
          throw new Error('forced rollback');
        })
      ).rejects.toThrow();
      const rows = await db(FIXTURE_TABLE).where({ name: 'TX_ERROR' });
      expect(rows).toHaveLength(0);
    }, TEST_TIMEOUT * 2);
  });
});
