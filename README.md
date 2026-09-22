# @dmalta/knex-db2

A [Knex.js](https://knexjs.org/) client adapter for IBM Db2 for z/OS using the [ibm_db](https://github.com/ibmdb/node-ibm_db/) driver via ODBC.

## Installation

```bash
npm install knex @dmalta/knex-db2 ibm_db
```

> IBM Db2 client libraries must also be installed on the host system for `ibm_db` to function.

## Usage

```javascript
const knex = require('knex');
const Db2Client = require('@dmalta/knex-db2');

const db = knex({
  client: Db2Client,
  connection: {
    hostname: 'your-db2-host',
    port: 50000,
    database: 'your-database',
    user: 'your-username',
    password: 'your-password',
    schema: 'MYSCHEMA',   // optional — sets CURRENTSCHEMA
  },
  pool: {
    min: 2,
    max: 10
  }
});
```

### Connection Options

| Option | Type | Required | Description |
|---|---|---|---|
| `hostname` | string | Required | DB2 server hostname |
| `port` | number | Required | Port (default: `50000`) |
| `database` | string | Required | Database name |
| `user` / `uid` | string | Required | Username |
| `password` / `pwd` | string | Required | Password |
| `schema` | string | Optional | Sets `CURRENTSCHEMA` |
| `connectTimeout` | number | Optional | Sets `CONNECTTIMEOUT` (seconds) |
| `queryTimeout` | number | Optional | Sets `QUERYTIMEOUT` (seconds) |
| `params` | object | Optional | Any additional ODBC key/value pairs appended to the connection string (see below) |

### Custom Connection Parameters (`params`)

Use `params` to pass any additional ODBC keyword/value pairs directly to the connection string:

```javascript
const db = knex({
  client: Db2Client,
  connection: {
    hostname: 'your-db2-host',
    port: 50000,
    database: 'your-database',
    user: 'your-username',
    password: 'your-password',
    // optional additional ODBC parameters
    params: { 
      Authentication: '...',
      Security: '...',
      sslConnection: '...',
      sslVersion: '...',
      sslTrustStoreLocation: '...',
      sslTrustStorePassword: '...',
      sslCertLocation: '...',
      ...
    }
  }
});

// Standard Knex.js API works seamlessly
const users = await db('users').select('*');
const limitedResults = await db('users').limit(10).offset(20);
```

## Features

- **Full Knex.js compatibility** — Drop-in replacement; all standard Knex query-builder methods work
- **DB2 z/OS SQL dialect** — `FETCH FIRST n ROWS ONLY`, `ROW_NUMBER()` pagination for z/OS V11, `TRUNCATE TABLE … IMMEDIATE`, `FOR UPDATE WITH RS` / `FOR FETCH ONLY` locking
- **Fast batch insert** — Multi-row inserts use ibm_db's column-wise ARRAY parameter mechanism for a single round-trip (DB2 z/OS does not support multi-VALUES syntax)
- **`INSERT … RETURNING`** — Single-row inserts with `.returning()` are wrapped in `SELECT … FROM FINAL TABLE (INSERT …)`
- **CTEs** — `WITH` clauses work; the `RECURSIVE` keyword is stripped automatically for z/OS compatibility
- **Case-insensitive `LIKE`** — `.whereILike()` emits `UPPER(col) LIKE UPPER(?)`
- **Column introspection** — `.columnInfo()` queries `SYSIBM.SYSCOLUMNS`
- **Tablespace support** — `t.tablespace('SCHEMA.TSNAME')` in `createTable` callbacks
- **Transactions** — Configurable isolation levels (`READ UNCOMMITTED`, `READ COMMITTED`, `REPEATABLE READ`, `SERIALIZABLE`) and SQL savepoints
- **Enhanced error handling** — Comprehensive DB2 SQLCODE mapping and categorization
- **Connection management** — Pooling, connection timeout, SSL, schema, and `SYSIBM.SYSDUMMY1` health checks
- **Schema operations** — Full DDL support for tables, indexes, and constraints

## Fast Batch Insert

When inserting an array of rows, the client automatically switches to ibm_db's ARRAY parameter mode, sending all rows in a **single SQL round-trip** instead of one statement per row:

```javascript
await db('employees').insert([
  { id: 1, name: 'Alice', dept: 'Engineering' },
  { id: 2, name: 'Bob',   dept: 'Marketing'   },
  { id: 3, name: 'Carol', dept: 'Engineering' },
]);
// Executes: INSERT INTO employees (id, name, dept) VALUES (?, ?, ?)
// with ibm_db ARRAY params — one round-trip for all rows
```

> `.returning()` is not supported with bulk (multi-row) inserts. Insert rows individually if you need returned values.

## INSERT … RETURNING

Single-row inserts support `.returning()` via DB2's `FINAL TABLE` syntax:

```javascript
const [row] = await db('employees')
  .insert({ name: 'Alice', dept: 'Engineering' })
  .returning(['id', 'created_at']);
// Executes: SELECT id, created_at FROM FINAL TABLE (INSERT INTO employees …)
```

## Error Handling

```javascript
const { DB2Error } = require('@dmalta/knex-db2');

try {
  await db('employees').select('*');
} catch (error) {
  if (error instanceof DB2Error) {
    console.log('Error type:',     error.errorType);
    console.log('Category:',       error.errorCategory);
    console.log('Is retryable:',   error.isRetryable());
  }
}
```

## Transactions & Isolation Levels

```javascript
// Set isolation level at the client level
const db = knex({
  client: Db2Client,
  connection: { … },
  isolationLevel: 'READ COMMITTED', // or 'REPEATABLE READ', 'SERIALIZABLE', etc.
});

// Use transactions as normal — savepoints are also supported
await db.transaction(async (trx) => {
  await trx('accounts').where({ id: 1 }).update({ balance: knex.raw('balance - 100') });
  await trx('accounts').where({ id: 2 }).update({ balance: knex.raw('balance + 100') });
});
```

## Data Type Mapping

| Knex Method | DB2 Type |
|-------------|----------|
| `increments()` | `INTEGER GENERATED BY DEFAULT AS IDENTITY` |
| `string(n)` | `VARCHAR(n)` |
| `text()` | `CLOB` |
| `integer()` | `INTEGER` |
| `decimal(p,s)` | `DECIMAL(p,s)` |
| `boolean()` | `SMALLINT` |
| `timestamp()` | `TIMESTAMP` |
| `binary()` | `BLOB` |

## Limitations

- **Stored procedures** — Not supported
- **`.returning()` with bulk inserts** — Not supported; use single-row inserts instead
- **DB2 for IBM i** — Not supported (use [@bdkinc/knex-ibmi](https://www.npmjs.com/package/@bdkinc/knex-ibmi) instead)

## Requirements

- Node.js 16+
- IBM Db2 client libraries installed on the system
- Access to an IBM Db2 for z/OS database
- [ibm_db](https://github.com/ibmdb/node-ibm_db/) `^3.3.2 || ^4.0.0` (peer dependency)
- [knex](https://knexjs.org/) `^3.0.0` (peer dependency)

## Compatibility Notes

An external project ran a time-boxed, read-only feasibility spike (Sept 2026) wiring this driver
into AdonisJS Lucid ORM against a real DB2 for z/OS database, using `ibm_db@4.0.1`. This driver
is not "Lucid-compatible" out of the box — the spike needed an external shim in the consuming
application to register the client with Lucid at all — but the following were confirmed working:

- Connection and raw query execution
- The query builder's `limit`/`offset` (`FETCH FIRST` / `ROW_NUMBER()` emulation)
- Row mapping into a model class
- A `TIMESTAMP` column round-tripping through Luxon-style datetime parsing
- Transactions (`begin`/`commit`, read-only)
- Multiple concurrently-open named connections

**Known sharp edge: alias casing.** DB2 for z/OS uppercases any unquoted identifier at the engine
level, and this driver's `wrapIdentifierImpl` (`src/client.js`) intentionally returns identifiers
unquoted (correct, documented DB2 semantics, relied on elsewhere by consumers of this driver).
This surprises ORM code written with Postgres/MySQL case-folding assumptions. Concrete example
from the spike:
Lucid's `.paginate()` runs `.count('* as total')` and then reads `result[0].total` back, but DB2
returns `TOTAL` instead — `Number(undefined)` is `NaN`, and Lucid guards its page query behind
`total > 0`, so the consumer silently gets an empty page back with no error.

This isn't this driver's bug to fix unilaterally, but the eventual fix would be to selectively
quote only *synthesized* aliases that the query compiler itself generates (the `AS <alias>` a
compiler emits for things like aggregate results), while leaving user-supplied table/column
identifiers unquoted exactly as today — quoting an alias makes DB2 preserve its case instead of
folding it to uppercase, without changing the uppercase-folding behavior existing consumers
already depend on for ordinary identifiers. The likely touch point for that future change is the
alias-emission code in `src/query/db2-querycompiler.js` — not `wrapIdentifierImpl`, since that
function is used for all identifiers, not just synthesized aliases. That change would need its
own unit test (asserting the compiler emits a quoted alias) and a live-DB2 integration test
(asserting the round-tripped key preserves case) before it should ship; it is not attempted here.

## License

MIT
