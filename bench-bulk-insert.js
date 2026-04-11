/**
 * Standalone benchmark: compare two bulk-insert strategies using ibm_db directly.
 *
 * NOTE: This is DB2 for z/OS — multi-row VALUES syntax is NOT supported.
 * So the realistic comparison is:
 *
 * Strategy A – "serial single-row inserts" (current knex-db2 behaviour):
 *   Loops N times, each: prepare + executeNonQuery with 1 row of bindings.
 *
 * Strategy B – "row-wise array insert" (ibm_db native):
 *   INSERT INTO t (c1, c2) VALUES (?,?)
 *   Passed to connection.query({ sql, rows: [[v1,v2],[v3,v4],...] })
 *   The ODBC driver sends all rows in a single SQLParamOptions/SQLExecute call.
 *
 * Run:  node bench-bulk-insert.js
 */
'use strict';

const ibmdb = require('ibm_db');
const config = require('./src/__tests__/integration/db2-config.json');

const ROWS = 500;   // keep runs manageable; serial inserts are ~130ms/row over WAN
const TABLE = 'BENCH_BULK';  // unqualified — resolved via CURRENTSCHEMA=KNEXTEST
const TABLESPACE = config.tablespace || 'DSQDBDEF.DSQTSDEF';

const connStr =
  `DATABASE=${config.database};` +
  `HOSTNAME=${config.hostname};` +
  `PORT=${config.port};` +
  `PROTOCOL=TCPIP;` +
  `UID=${config.user};` +
  `PWD=${config.password};`;
// No CURRENTSCHEMA — tables land in the PRESS schema where the user has rights.

// ── helpers ──────────────────────────────────────────────────────────────────

function buildRows(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push([i, `label-${i}`]);
  }
  return rows;
}

async function truncate(conn) {
  // Use WHERE 1=1 to avoid SQL0513W (z/OS warns on unqualified DELETE)
  await conn.query(`DELETE FROM ${TABLE} WHERE id >= 0`);
}

async function setup(conn) {
  try {
    await conn.query(`DROP TABLE ${TABLE}`);
  } catch { /* ignore if not exists */ }
  await conn.query(`CREATE TABLE ${TABLE} (id INT NOT NULL, label VARCHAR(20) NOT NULL) IN ${TABLESPACE}`);
  console.log(`Table ${TABLE} created.\n`);
}

function hrtimeMs(start) {
  const [s, ns] = process.hrtime(start);
  return (s * 1e3 + ns / 1e6).toFixed(1);
}

// ── Strategy A: serial single-row inserts (current knex-db2 behaviour) ───────
async function strategyA(conn, rows) {
  const sql = `INSERT INTO ${TABLE} (id, label) VALUES (?,?)`;
  for (const row of rows) {
    const stmt = await conn.prepare(sql);
    try {
      await stmt.executeNonQuery(row);
    } finally {
      stmt.closeSync();
    }
  }
}

// ── Strategy B: column-wise array insert (ibm_db native, single ODBC call) ───
// Transposes row-major [[id,label],...] to column-major ARRAY params,
// then issues a single conn.query() that maps to one SQLexecute call.
async function strategyB(conn, rows) {
  const ids    = rows.map(r => r[0]);
  const labels = rows.map(r => r[1]);

  const param1 = { ParamType: 'ARRAY', DataType: 4,  Data: ids };           // SQL_INTEGER
  const param2 = { ParamType: 'ARRAY', DataType: 12, Data: labels, Length: 20 }; // SQL_VARCHAR

  await conn.query({
    sql:       `INSERT INTO ${TABLE} (id, label) VALUES (?, ?)`,
    params:    [param1, param2],
    ArraySize: rows.length,
  });
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Connecting to ${config.hostname}:${config.port}/${config.database} ...`);
  const conn = await ibmdb.open(connStr);
  console.log('Connected.\n');

  await setup(conn);

  const rows = buildRows(ROWS);
  const RUNS = 3;

  console.log(`=== Strategy A: serial single-row inserts, ${ROWS} rows ===`);
  const timesA = [];
  for (let r = 0; r < RUNS; r++) {
    await truncate(conn);
    const t = process.hrtime();
    await strategyA(conn, rows);
    const ms = hrtimeMs(t);
    timesA.push(parseFloat(ms));
    console.log(`  run ${r + 1}: ${ms} ms`);
  }
  const avgA = (timesA.reduce((a, b) => a + b, 0) / RUNS).toFixed(1);
  console.log(`  avg: ${avgA} ms\n`);

  console.log(`=== Strategy B: column-wise array insert (ibm_db native), ${ROWS} rows ===`);
  const timesB = [];
  for (let r = 0; r < RUNS; r++) {
    await truncate(conn);
    const t = process.hrtime();
    await strategyB(conn, rows);
    const ms = hrtimeMs(t);
    timesB.push(parseFloat(ms));
    console.log(`  run ${r + 1}: ${ms} ms`);
  }
  const avgB = (timesB.reduce((a, b) => a + b, 0) / RUNS).toFixed(1);
  console.log(`  avg: ${avgB} ms\n`);

  const ratio = (parseFloat(avgA) / parseFloat(avgB)).toFixed(2);
  console.log(`=== Result ===`);
  console.log(`  Strategy A avg: ${avgA} ms`);
  console.log(`  Strategy B avg: ${avgB} ms`);
  console.log(`  Speedup (A/B):  ${ratio}x`);

  await conn.query(`DROP TABLE ${TABLE}`);
  await conn.close();
}

main().catch((err) => {
  console.error('Benchmark failed:', err.message || err);
  process.exit(1);
});
