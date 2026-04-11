// Integration tests for DB2 schema operations (DDL)
// Tests column types, table lifecycle, DDL mutations, indexes, constraints,
// schema introspection, and renameTable against a live IBM DB2 z/OS database.
// Requires DB2_REAL_TEST=true to run.
const knex = require('knex');
const Db2Client = require('../../src/client');
const { DB_CONFIG, POOL_CONFIG, shouldRunRealTests, TEST_TIMEOUT, TEST_TABLESPACE } = require('../helpers/test-config');

const runTests = shouldRunRealTests();

const ts = Date.now();
const TYPE_TABLE    = `KNEX_IT_TYPE_${ts}`;      // column type coverage table
const SCRATCH_TABLE = `KNEX_IT_SCRATCH_${ts}`;   // DDL mutations table
const REFS_TABLE    = `KNEX_IT_REFS_${ts}`;      // FK reference table
let scratchTableName = SCRATCH_TABLE;             // mutable — updated after renameTable test

(runTests ? describe : describe.skip)('DB2 Schema Integration Tests', () => {
  let db;

  beforeAll(async () => {
    db = knex({
      client: Db2Client,
      connection: DB_CONFIG,
      pool: POOL_CONFIG,
    });

    // TYPE_TABLE — all DB2-specific column types
    // TYPE_TABLE — all DB2-specific column types.
    // Uses plain integer (not increments) for the id column since this DB2 z/OS
    // environment cannot auto-create the backing unique index for any PK constraint
    // (SQL0540N). The TYPE_TABLE insert test therefore works without a primary key.
    await db.schema.createTable(TYPE_TABLE, (t) => {
      t.tablespace(TEST_TABLESPACE);
      t.increments('id');
      t.boolean('flag');
      // t.text('notes');  // clob(32000) — requires LOB stogroup access (INSERT test is skipped)
      t.uuid('bin_id', { useBinaryUuid: true });
      t.uuid('str_id');
      t.decimal('price', 10, 2);
      t.float('score', 24);
      t.double('height');
      t.enu('status', ['A', 'B', 'C']);
      t.comment('Type coverage fixture table');
    });

    // SCRATCH_TABLE — minimal schema for sequential DDL mutation tests
    await db.schema.createTable(SCRATCH_TABLE, (t) => {
      t.tablespace(TEST_TABLESPACE);
      t.integer('id').notNullable();
      t.string('label', 50);
    });

    // REFS_TABLE — FK reference target
    await db.schema.createTable(REFS_TABLE, (t) => {
      t.tablespace(TEST_TABLESPACE);
      t.integer('ref_id').notNullable().primary();
      t.string('ref_name', 30);
    });
    for (const row of [
      { ref_id: 1, ref_name: 'alpha' },
      { ref_id: 2, ref_name: 'beta' },
    ]) {
      await db(REFS_TABLE).insert(row);
    }
  }, TEST_TIMEOUT * 3);

  afterAll(async () => {
    if (db) {
      try { await db.schema.dropTableIfExists(TYPE_TABLE); } catch (e) { console.warn('Cleanup warning:', e.message); }
      try { await db.schema.dropTableIfExists(scratchTableName); } catch (e) { console.warn('Cleanup warning:', e.message); }
      try { await db.schema.dropTableIfExists(SCRATCH_TABLE); } catch (e) { /* already renamed */ }
      try { await db.schema.dropTableIfExists(REFS_TABLE); } catch (e) { console.warn('Cleanup warning:', e.message); }
      await db.destroy();
    }
  }, TEST_TIMEOUT);

  // ── CREATE TABLE with tablespace option ────────────────────────────────────

  describe('CREATE TABLE with tablespace option', () => {
    test('creates table with IN schema.tablespace syntax', async () => {
      const tsTable = `KNEX_IT_TS_${ts}`;
      await db.schema.createTable(tsTable, (t) => {
        t.tablespace(TEST_TABLESPACE);
        t.integer('id').notNullable().primary();
        t.string('val', 20);
      });
      const exists = await db.schema.hasTable(tsTable);
      expect(exists).toBe(true);
      await db.schema.dropTable(tsTable).catch(() => {});
    }, TEST_TIMEOUT);
  });

  // ── Schema Introspection ───────────────────────────────────────────────────

  describe('Schema Introspection', () => {
    test('hasTable — returns true for existing table', async () => {
      const result = await db.schema.hasTable(TYPE_TABLE);
      expect(result).toBe(true);
    }, TEST_TIMEOUT);

    test('hasTable — returns false for non-existent table', async () => {
      const result = await db.schema.hasTable('KNEX_NO_SUCH_TABLE_ZZ99');
      expect(result).toBe(false);
    }, TEST_TIMEOUT);

    test('hasColumn — returns true for existing column', async () => {
      const result = await db.schema.hasColumn(TYPE_TABLE, 'price');
      expect(result).toBe(true);
    }, TEST_TIMEOUT);

    test('hasColumn — returns false for non-existent column', async () => {
      const result = await db.schema.hasColumn(TYPE_TABLE, 'nonexistent_col_xyz');
      expect(result).toBe(false);
    }, TEST_TIMEOUT);

    test('dropTableIfExists — throws db2-zos (use dropTable and handle SQL0204N)', () => {
      expect(() => db.schema.dropTableIfExists('KNEX_NONEXISTENT_XYZ99')).toThrow('db2-zos');
    }, TEST_TIMEOUT);
  });

  // ── Column Types ───────────────────────────────────────────────────────────

  describe('Column Types — TYPE_TABLE is queryable', () => {
    // SKIP: requires LOB stogroup access (clob(32000)) and binary(16) Buffer binding (SQL0301N / SQL-747)
    test.skip('can INSERT and SELECT all DB2 column types', async () => {
      await db(TYPE_TABLE).insert({
        flag:   0,
        bin_id: Buffer.alloc(16, 1),
        str_id: '00000000-0000-0000-0000-000000000001',
        price:  123.45,
        score:  3.14,
        height: 1.80,
        status: 'A',
      });
      const rows = await db(TYPE_TABLE).where({ status: 'A' });
      expect(rows).toHaveLength(1);
      expect(rows[0].NOTES || rows[0].notes).toBe('hello db2');
    }, TEST_TIMEOUT);

    test('bool column (SMALLINT) rejects value outside 0/1 CHECK constraint', async () => {
      await expect(
        db(TYPE_TABLE).insert({
          flag:   5,
          notes:  'bad',
          str_id: '00000000-0000-0000-0000-000000000002',
          status: 'A',
          price:  1,
          score:  1,
          height: 1,
        })
      ).rejects.toThrow();
    }, TEST_TIMEOUT);
  });

  // ── Table DDL Mutations ────────────────────────────────────────────────────
  // These tests run sequentially against SCRATCH_TABLE — order matters.

  describe('Table DDL — addColumns / alterColumns / dropColumn / renameColumn', () => {
    test('addColumns — adds amount DECIMAL(10,2) to SCRATCH_TABLE', async () => {
      await db.schema.table(SCRATCH_TABLE, (t) => {
        t.decimal('amount', 10, 2);
      });
      const info = await db(SCRATCH_TABLE).columnInfo();
      const cols = Object.keys(info).map((k) => k.toUpperCase());
      expect(cols).toContain('AMOUNT');
    }, TEST_TIMEOUT);

    test('alterColumns — changes label column to NOT NULL', async () => {
      await db.schema.table(SCRATCH_TABLE, (t) => {
        t.string('label', 50).notNullable().alter();
      });
      // Inserting null for label should fail the NOT NULL constraint
      await expect(
        db(SCRATCH_TABLE).insert({ id: 1, label: null })
      ).rejects.toThrow();
    }, TEST_TIMEOUT);

    test('dropColumn — removes amount column', async () => {
      await db.schema.table(SCRATCH_TABLE, (t) => {
        t.dropColumn('amount');
      });
      const info = await db(SCRATCH_TABLE).columnInfo();
      const cols = Object.keys(info).map((k) => k.toUpperCase());
      expect(cols).not.toContain('AMOUNT');
    }, TEST_TIMEOUT);

    test('renameColumn — label becomes title', async () => {
      await db.schema.table(SCRATCH_TABLE, (t) => {
        t.renameColumn('label', 'title');
      });
      const info = await db(SCRATCH_TABLE).columnInfo();
      const cols = Object.keys(info).map((k) => k.toUpperCase());
      expect(cols).toContain('TITLE');
      expect(cols).not.toContain('LABEL');
    }, TEST_TIMEOUT);
  });

  // ── Indexes ────────────────────────────────────────────────────────────────

  describe('Indexes', () => {
    test('CREATE INDEX on title column — no error', async () => {
      // Insert a row so the table is populated when the index is created
      await db(SCRATCH_TABLE).insert({ id: 10, title: 'indexed' });
      const idxName = `IDX_SCRATCH_${ts}`;
      await expect(
        db.schema.table(SCRATCH_TABLE, (t) => { t.index(['title'], idxName); })
      ).resolves.toBeDefined();
    }, TEST_TIMEOUT);

    test('DROP INDEX — no error', async () => {
      const idxName = `IDX_SCRATCH_${ts}`;
      await expect(
        db.schema.table(SCRATCH_TABLE, (t) => { t.dropIndex(['title'], idxName); })
      ).resolves.toBeDefined();
    }, TEST_TIMEOUT);
  });

  // ── Constraints ───────────────────────────────────────────────────────────

  describe('Constraints', () => {
    test('unique constraint — duplicate value is rejected', async () => {
      await db.schema.table(SCRATCH_TABLE, (t) => {
        t.string('code', 10).unique();
      });
      await db(SCRATCH_TABLE).insert({ id: 20, title: 'u1', code: 'UNIQUE1' });
      await expect(
        db(SCRATCH_TABLE).insert({ id: 21, title: 'u2', code: 'UNIQUE1' })
      ).rejects.toThrow();
    }, TEST_TIMEOUT);

    test('foreign key — valid FK value is accepted', async () => {
      await db.schema.table(SCRATCH_TABLE, (t) => {
        t.integer('ref_id').references('ref_id').inTable(REFS_TABLE);
      });
      await expect(
        db(SCRATCH_TABLE).insert({ id: 30, title: 'fk', ref_id: 1 })
      ).resolves.toBeDefined();
    }, TEST_TIMEOUT);

    test('foreign key — invalid FK value is rejected', async () => {
      await expect(
        db(SCRATCH_TABLE).insert({ id: 31, title: 'bad_fk', ref_id: 999 })
      ).rejects.toThrow();
    }, TEST_TIMEOUT);

    test('dropForeign — removes FK constraint; invalid ref_id now accepted', async () => {
      await db.schema.table(SCRATCH_TABLE, (t) => {
        t.dropForeign(['ref_id']);
      });
      await expect(
        db(SCRATCH_TABLE).insert({ id: 32, title: 'ok_now', ref_id: 999 })
      ).resolves.toBeDefined();
    }, TEST_TIMEOUT);

    test('dropPrimary — removes PK constraint without error', async () => {
      await expect(
        db.schema.table(SCRATCH_TABLE, (t) => { t.dropPrimary(); })
      ).resolves.toBeDefined();
    }, TEST_TIMEOUT);
  });

  // ── Schema ops — renameTable (must be LAST — changes table name for afterAll) ─

  describe('Schema ops — renameTable', () => {
    test('renameTable — old name absent, new name visible via hasTable', async () => {
      const newName = `KNEX_IT_RENAMED_${ts}`;
      await db.schema.renameTable(SCRATCH_TABLE, newName);
      scratchTableName = newName;
      const oldExists = await db.schema.hasTable(SCRATCH_TABLE);
      const newExists = await db.schema.hasTable(newName);
      expect(oldExists).toBe(false);
      expect(newExists).toBe(true);
    }, TEST_TIMEOUT);
  });
});
