/**
 * Standalone integration test: validate SELECT FROM FINAL TABLE (INSERT ...) on DB2 z/OS.
 *
 * This validates that DB2 z/OS correctly returns column values from an INSERT
 * using the "data change table reference" syntax introduced in V9:
 *
 *   SELECT col1, col2
 *   FROM FINAL TABLE (INSERT INTO t (col1, col2) VALUES (?, ?))
 *
 * Because the outer statement is a SELECT, ibm_db routes it through execute()
 * → fetchAllSync() rather than executeNonQuery(), so rows come back normally.
 *
 * Run:  DB2_REAL_TEST=true npx vitest run tests/integration/returning.test.js
 */
'use strict';

const knex = require('knex');
const Db2Client = require('../../src/client');
const { DB_CONFIG, TEST_TABLESPACE, POOL_CONFIG, shouldRunRealTests, TEST_TIMEOUT } = require('../helpers/test-config');

const TABLE = 'BENCH_RETURNING';

const runTests = shouldRunRealTests();

(runTests ? describe : describe.skip)('INSERT … RETURNING via SELECT FROM FINAL TABLE', () => {
  let db;

  beforeAll(async () => {
    db = knex({
      client: Db2Client,
      connection: DB_CONFIG,
      pool: POOL_CONFIG,
    });

    // Drop and recreate the test table.
    // Identity column lets us validate that the generated value is returned.
    await db.raw(`DROP TABLE ${TABLE}`).catch(() => {});
    await db.raw(
      `CREATE TABLE ${TABLE} (` +
      `id INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1), ` +
      `label VARCHAR(50) NOT NULL` +
      `) IN ${TEST_TABLESPACE}`
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (db) {
      await db.raw(`DROP TABLE ${TABLE}`).catch(() => {});
      await db.destroy();
    }
  }, TEST_TIMEOUT);

  test('returns all requested columns after a single-row insert', async () => {
    const sql = `
      SELECT id, label
      FROM FINAL TABLE (
        INSERT INTO ${TABLE} (label) VALUES (?)
      )
    `;

    const rows = await db.raw(sql, ['hello-returning']);

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    // Identity value must be a positive integer
    const id = row.ID ?? row.id;
    const label = row.LABEL ?? row.label;
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
    // Inserted label must round-trip correctly
    expect(label).toBe('hello-returning');
  }, TEST_TIMEOUT);

  test('returns a different identity value for each row', async () => {
    const sql = `
      SELECT id
      FROM FINAL TABLE (
        INSERT INTO ${TABLE} (label) VALUES (?)
      )
    `;

    const [r1, r2] = await Promise.all([
      db.raw(sql, ['row-a']),
      db.raw(sql, ['row-b']),
    ]);

    const id1 = (r1[0].ID ?? r1[0].id);
    const id2 = (r2[0].ID ?? r2[0].id);

    expect(id1).toBeGreaterThan(0);
    expect(id2).toBeGreaterThan(0);
    expect(id1).not.toBe(id2);
  }, TEST_TIMEOUT);

  test('returns only the columns listed in the SELECT', async () => {
    const sql = `
      SELECT label
      FROM FINAL TABLE (
        INSERT INTO ${TABLE} (label) VALUES (?)
      )
    `;

    const rows = await db.raw(sql, ['only-label']);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    // Only the label column should be present
    expect(row.LABEL ?? row.label).toBe('only-label');
    // id should not appear
    expect(row.ID ?? row.id).toBeUndefined();
  }, TEST_TIMEOUT);

  test('query() routes FINAL TABLE statement through execute() not executeNonQuery()', async () => {
    // This verifies the routing logic in client.query(): a statement that begins
    // with SELECT is classified as a query even though it contains an INSERT.
    // If executeNonQuery() were used instead, rows would be undefined / empty.
    const sql = `
      SELECT id, label
      FROM FINAL TABLE (
        INSERT INTO ${TABLE} (label) VALUES (?)
      )
    `;

    // Use db.raw() which goes through client.query() → _executeQuery path
    const rows = await db.raw(sql, ['routing-check']);

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(1);
    expect((rows[0].LABEL ?? rows[0].label)).toBe('routing-check');
  }, TEST_TIMEOUT);
});
