# Creating a Knex Dialect for IBM DB2 for z/OS

This guide is a planning reference for implementing a custom Knex dialect targeting **IBM DB2 for z/OS** in the **current Knex 3.2.x codebase**. It describes the extension points that exist in this repository today, the DB2 for z/OS SQL differences the implementation must account for, and the repo-level work needed beyond the core client/compiler classes.

This document is intentionally conservative where DB2 behavior is strongly dependent on the target **z/OS release** or **package/plan settings**. The Node.js driver choice is now fixed to `ibm_db`. If a statement affects portability or public API compatibility, it is called out as a decision or validation item rather than presented as a settled fact.

Current planning decisions captured from discussion:

- Driver: `ibm_db`
- Minimum DB2 for z/OS baseline: Version 11
- Transaction handling: prefer `ibm_db` native transaction APIs over SQL-text transaction control
- Conditional DDL strategy: use stepwise migration logic rather than compound SQL blocks
- First milestone feature envelope: core DML, transactions, basic schema operations, indexes, comments, and catalog-backed metadata helpers

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Class Hierarchy](#class-hierarchy)
3. [Client (Entry Point)](#1-client-entry-point)
4. [QueryCompiler (DML)](#2-querycompiler-dml)
5. [QueryBuilder (DML)](#3-querybuilder-dml)
6. [SchemaCompiler (DDL – Top Level)](#4-schemacompiler-ddl--top-level)
7. [TableCompiler (DDL – Table Level)](#5-tablecompiler-ddl--table-level)
8. [ColumnCompiler (DDL – Column Level)](#6-columncompiler-ddl--column-level)
9. [Transaction](#7-transaction)
10. [Formatter / Identifier Quoting](#8-formatter--identifier-quoting)
11. [Wire Protocol / Runner Hooks](#9-wire-protocol--runner-hooks)
12. [File Layout Recommendation](#10-file-layout-recommendation)
13. [Registration / Usage](#11-registration--usage)
14. [Repository Integration Checklist](#12-repository-integration-checklist)
15. [Validation Backlog Before Coding](#13-validation-backlog-before-coding)
16. [Quick-Reference: DB2 for z/OS SQL Specifics](#14-quick-reference-db2-for-zos-sql-specifics)

---

## Architecture Overview

Knex separates **building** from **compiling**.

- Builder classes (`QueryBuilder`, `SchemaBuilder`, `TableBuilder`, `ColumnBuilder`, `ViewBuilder`) record fluent API calls as plain statement objects.
- Compiler classes (`QueryCompiler`, `SchemaCompiler`, `TableCompiler`, `ColumnCompiler`, `ViewCompiler`) turn those recorded statements into SQL strings plus bindings.
- The **Client** is the dialect registry and runtime adapter. It chooses builders/compilers, provides parameter and identifier behavior, owns the connection pool, and translates raw driver responses into user-facing results.

For planning purposes, the important point is that a new dialect is not just SQL generation. A production-ready dialect in this repo also needs to align with:

- the current builder/compiler factory methods on `lib/client.js`
- runtime hooks like `_query()`, `_stream()`, `processResponse()`, `prepBindings()`, and `positionBindings()`
- schema/view support expectations
- dialect registration and the existing unit/integration test harnesses

```
User code
    │
    ▼
SchemaBuilder / QueryBuilder / ColumnBuilder / TableBuilder / ViewBuilder
    │   (records method calls as a sequence of plain objects)
    │
    ▼
SchemaCompiler / QueryCompiler / TableCompiler / ColumnCompiler / ViewCompiler
    │   (converts recorded calls to SQL strings + binding arrays)
    │
    ▼
Client  ──►  Runner  ──►  DB driver (`ibm_db`)
    │             │
    │             └─► executes SQL, parses response rows
  └─► Transaction (coordinates BEGIN / SAVEPOINT / COMMIT / ROLLBACK)
```

---

## Class Hierarchy

```
lib/client.js                     ← base Client
lib/query/querycompiler.js        ← base QueryCompiler
lib/query/querybuilder.js         ← base QueryBuilder (usually reused as-is)
lib/schema/compiler.js            ← base SchemaCompiler
lib/schema/tablecompiler.js       ← base TableCompiler
lib/schema/columncompiler.js      ← base ColumnCompiler
lib/schema/viewcompiler.js        ← base ViewCompiler
lib/execution/transaction.js      ← base Transaction
lib/formatter.js                  ← base Formatter

Your dialect:
  lib/dialects/db2-zos/index.js                         ← Client_DB2ZOS
  lib/dialects/db2-zos/query/db2zos-querycompiler.js   ← QueryCompiler_DB2ZOS
  lib/dialects/db2-zos/query/db2zos-querybuilder.js    ← optional QueryBuilder_DB2ZOS
  lib/dialects/db2-zos/schema/db2zos-compiler.js       ← SchemaCompiler_DB2ZOS
  lib/dialects/db2-zos/schema/db2zos-tablecompiler.js  ← TableCompiler_DB2ZOS
  lib/dialects/db2-zos/schema/db2zos-columncompiler.js ← ColumnCompiler_DB2ZOS
  lib/dialects/db2-zos/schema/db2zos-columnbuilder.js  ← optional ColumnBuilder_DB2ZOS
  lib/dialects/db2-zos/schema/db2zos-viewcompiler.js   ← optional ViewCompiler_DB2ZOS
  lib/dialects/db2-zos/schema/db2zos-viewbuilder.js    ← optional ViewBuilder_DB2ZOS
  lib/dialects/db2-zos/transaction.js                  ← optional Transaction_DB2ZOS
```

In addition to these runtime files, a complete dialect addition for this repository normally also touches:

- `lib/dialects/index.js`
- `lib/dialects/index.ts`
- `test/knexfile.js`
- targeted unit tests under `test/unit/`
- integration wiring under `test/integration/` and `test/integration2/`

---

## 1. Client (Entry Point)

**Base class:** `lib/client.js`

The Client class is the root object. A Knex instance is created by passing `{ client: 'db2-zos' }` (or the class itself) to `knex()`. Every compiler and builder instance is created via factory methods on the client.

### Mandatory properties (set on prototype)

| Property | Type | Example | Notes |
|---|---|---|---|
| `dialect` | string | `'db2-zos'` | Identifies the dialect in logs |
| `driverName` | string | `'ibm_db'` | Name of the npm package; triggers `initializeDriver()` |

### Factory methods to override

At minimum, return your dialect-specific compiler instances. In current Knex, the idiomatic pattern is to forward `...arguments` so you do not accidentally depend on stale constructor assumptions.

```js
// lib/dialects/db2-zos/index.js
const Client = require('../../client');
const QueryCompiler = require('./query/db2zos-querycompiler');
const SchemaCompiler = require('./schema/db2zos-compiler');
const TableCompiler  = require('./schema/db2zos-tablecompiler');
const ColumnCompiler = require('./schema/db2zos-columncompiler');
const ViewCompiler = require('./schema/db2zos-viewcompiler');
const Transaction    = require('./transaction');

class Client_DB2ZOS extends Client {
  queryCompiler() {
    return new QueryCompiler(this, ...arguments);
  }
  schemaCompiler() {
    return new SchemaCompiler(this, ...arguments);
  }
  tableCompiler() {
    return new TableCompiler(this, ...arguments);
  }
  columnCompiler() {
    return new ColumnCompiler(this, ...arguments);
  }
  viewCompiler() {
    return new ViewCompiler(this, ...arguments);
  }
  transaction() {
    return new Transaction(this, ...arguments);
  }
}

Object.assign(Client_DB2ZOS.prototype, {
  dialect:    'db2-zos',
  driverName: 'ibm_db',
});

module.exports = Client_DB2ZOS;
```

> **Current-state note:** `Client.queryCompiler(builder, formatter)` still exists as a method signature in `lib/client.js`, but internally the second argument is effectively a bindings holder in current code paths. Do not write the dialect as if a prebuilt `Formatter` instance is passed in.

### Optional factory methods to plan explicitly

- `queryBuilder()` only if DB2-specific fluent methods are needed
- `columnBuilder()` only if you need dialect-only column builder methods
- `viewBuilder()` / `viewCompiler()` if DB2 view support is a milestone goal
- `formatter()` only if DB2 requires formatter behavior beyond `wrapIdentifierImpl()`, `alias()`, `parameter()`, and related Client hooks

### Connection lifecycle methods

These must all be overridden to use your chosen Node.js DB2 driver. The pool calls `acquireRawConnection()` to create new connections and `destroyRawConnection()` to close them.

#### `_driver()`

Returns the required npm module. Called once during `initializeDriver()`.

```js
_driver() {
  return require('ibm_db');
}
```

#### `acquireRawConnection() → Promise<connection>`

Opens a new raw connection to DB2 and returns it. The connection object is stored in the pool and passed to `_query()` / `_stream()`.

```js
acquireRawConnection() {
  return new Promise((resolve, reject) => {
    const connStr = this._buildConnectionString();
    this.driver.open(connStr, (err, conn) => {
      if (err) return reject(err);
      conn.__knex__disposed = false;
      resolve(conn);
    });
  });
}
```

#### `validateConnection(connection) → boolean`

Called by the pool before reusing a connection. Return `true` if the connection is still alive.

```js
validateConnection(connection) {
  return connection && !connection.__knex__disposed;
}
```

#### `destroyRawConnection(connection) → Promise<void>`

Called by the pool when a connection should be closed.

```js
destroyRawConnection(connection) {
  return new Promise((resolve, reject) => {
    connection.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}
```

#### `_query(connection, queryObject) → Promise<queryObject>`

Executes a single SQL statement. Mutates `queryObject.response` with the raw result rows. This is the lowest-level execution hook.

```js
_query(connection, queryObject) {
  return new Promise((resolve, reject) => {
    const { sql, bindings } = queryObject;
    connection.query(sql, bindings || [], (err, rows) => {
      if (err) return reject(err);
      queryObject.response = rows;
      resolve(queryObject);
    });
  });
}
```

#### `processResponse(queryObject, runner) → any`

Converts the raw driver response into the value Knex returns to the user. Must handle all DML verbs. The `method` property on `queryObject` is one of `'select'`, `'first'`, `'pluck'`, `'insert'`, `'update'`, `'del'`, `'counter'`, `'raw'`.

```js
processResponse(queryObject, runner) {
  if (queryObject == null) return;
  const { response, method } = queryObject;
  if (queryObject.output) return queryObject.output.call(runner, response);
  switch (method) {
    case 'select': return response;
    case 'first':  return response[0];
    case 'pluck':  return response.map(row => row[queryObject.pluck]);
    case 'insert':
    case 'del':
    case 'update':
    case 'counter': return response;
    default: return response;
  }
}
```

### Other Client hooks that affect compiler design

These are easy to overlook during planning, but real dialects in this repo often depend on them:

#### `prepBindings(bindings) → bindings`

Use this when the driver needs bind values transformed before execution, for example booleans, LOB placeholders, output parameters, or driver-specific wrapper objects.

#### `parameter(value, builder, bindingsHolder) → string`

The base implementation already handles callbacks, raw values, and standard `?` placeholders. Override only if the driver requires special parameter objects or output-bind behavior.

#### `alias(first, second) → string`

The base implementation emits `first as second`. Override only if DB2 syntax or a chosen driver requires a different alias form.

#### `_escapeBinding(value) → string`

This powers default literal escaping used by `formatDefault()` and the generic `check*` helpers in `ColumnCompiler`. If DB2 string literal escaping needs special handling beyond ANSI single-quote escaping, override it at the Client level.

### Binding / identifier methods

#### `positionBindings(sql) → string`

DB2 uses `?` placeholders natively and `ibm_db` accepts them, so you can keep `positionBindings()` as a no-op unless later driver behavior proves otherwise.

```js
// DB2 CLI / ibm_db accepts '?' natively — no-op is fine
positionBindings(sql) {
  return sql;  // keep '?'
}
```

If you need ODBC-style `?` but your base implementation already does that, inherit from the base class without override.

#### `wrapIdentifierImpl(value) → string`

DB2 for z/OS supports quoted identifiers, but the current planning decision is **not** to emit double quotes by default. Instead, emit plain identifiers and rely on DB2's normal unquoted-name rules.

```js
wrapIdentifierImpl(value) {
  return value === '*' ? '*' : value;
}
```

> **Important consequence:** unquoted identifiers are folded by DB2 according to its normal rules, which effectively means uppercase internal names. This keeps emitted SQL simpler, but reserved words, special characters, and truly case-sensitive object names are not good phase-1 targets.

#### `database() → string`

For DB2 for z/OS, the concept equivalent to "database" is the **subsystem** or the schema. Return the configured `database` connection option.

```js
database() {
  return this.connectionSettings.database;
}
```

---

## 2. QueryCompiler (DML)

**Base class:** `lib/query/querycompiler.js`
**Analogous dialects:** MSSQL (`lib/dialects/mssql/query/mssql-querycompiler.js`), Oracle (`lib/dialects/oracle/query/oracle-querycompiler.js`)

The `QueryCompiler` converts the query builder's internal statement tree into SQL strings. Every public method on this class corresponds to one SQL verb or clause.

### Constructor

Always call `super(client, builder, formatter)`. In practice the third argument is the current bindings holder. You may reject unsupported features in the constructor, which is how existing dialects fail early for things like `.onConflict()`.

```js
const QueryCompiler = require('../../../query/querycompiler');

class QueryCompiler_DB2ZOS extends QueryCompiler {
  constructor(client, builder, formatter) {
    super(client, builder, formatter);

    if (this.single.onConflict) {
      throw new Error('.onConflict() is not supported for db2-zos.');
    }

    // If the chosen DB2 target accepts it, use 'DEFAULT VALUES' for empty inserts.
    this._emptyInsertValue = 'DEFAULT VALUES';
  }
}
```

### `select() → string`

Assembles the full SELECT statement. The base implementation joins the `components` array in order. DB2 does not have a `WITH (NOLOCK)` clause or `TOP N` syntax. Override only to change the component list.

DB2 for z/OS supports `FETCH FIRST n ROWS ONLY` for pagination (see `limit()` / `offset()` below), so the component list stays the same as the base class. The base `select()` is usually sufficient.

### `insert() → string | object`

DB2 requires standard `INSERT INTO table (cols) VALUES (...)` syntax. The base implementation covers the common case. The two planning issues are:

1. **Empty insert**: confirm whether the target DB2 release accepts `DEFAULT VALUES` directly. If not, you will need a dialect override.
2. **`.returning()` strategy**: DB2 for z/OS should be treated as **not supporting generic `RETURNING` parity** for the first milestone. If you later emulate identity retrieval with `IDENTITY_VAL_LOCAL()`, scope that carefully to single-row identity inserts and document the limits.

```js
insert() {
  if (this.single.returning) {
    throw new Error('.returning() is not yet supported for db2-zos.');
  }

  return super.insert();
}
```

That is the safer starting point for a new dialect in Knex. If `.returning()` support is later required, plan it as a separate milestone with driver-verified behavior.

### `update() → string`

DB2 supports standard `UPDATE t SET col = val WHERE ...`. The base implementation is correct. Override only if you need to support `UPDATE ... FROM` join semantics (which DB2 handles via a correlated subquery or a `MERGE` statement instead).

### `del() → string`

The base implementation produces `DELETE FROM table WHERE ...`. DB2 for z/OS accepts this. No override required unless you need `DELETE ... FROM` join syntax — in that case use a subquery approach.

### `truncate() → string`

DB2 for z/OS supports `TRUNCATE TABLE name` (introduced in V9). Older systems (V8) used `DELETE FROM name` without a WHERE clause. The base class produces `truncate tableName` (no `TABLE` keyword). Override:

```js
truncate() {
  // DB2 for z/OS V9+:  TRUNCATE TABLE t IMMEDIATE
  // Older V8/pre-V9:   DELETE FROM t (no TRUNCATE support)
  return `TRUNCATE TABLE ${this.tableName} IMMEDIATE`;
}
```

### `limit() → string`

DB2 for z/OS does **not** support `LIMIT n`. It uses `FETCH FIRST n ROWS ONLY` appended to the query. Override:

```js
limit() {
  const noLimit = !this.single.limit && this.single.limit !== 0;
  if (noLimit) return '';
  // Do not emit here — emitted by offset() or appended at end of select()
  return '';
}
```

### `offset() → string`

Because the minimum supported baseline for this plan is **DB2 for z/OS V11**, do not rely on native `OFFSET ... FETCH NEXT ...` support. Plan on `ROW_NUMBER()`-based offset emulation for portability within the supported baseline.

```js
offset() {
  const noLimit  = !this.single.limit && this.single.limit !== 0;
  const noOffset = !this.single.offset;

  if (noLimit && noOffset) return '';

  // This shape only applies if a later baseline adds native OFFSET support:
  const offsetClause = noOffset
    ? ''
    : `OFFSET ${this._getValueOrParameterFromAttribute('offset')} ROWS `;
  const fetchClause  = noLimit
    ? ''
    : `FETCH NEXT ${this._getValueOrParameterFromAttribute('limit')} ROWS ONLY`;

  return (offsetClause + fetchClause).trim();
}
```

For the locked V11 baseline, wrap the whole `select()` result in a `ROW_NUMBER()` outer query inside the `select()` override:

```js
// Pre-V12 OFFSET emulation via ROW_NUMBER()
select() {
  const inner  = super.select();
  const limit  = this.single.limit;
  const offset = this.single.offset;

  const hasLimit  = limit != null;
  const hasOffset = offset != null;

  if (!hasOffset) return inner;   // FETCH FIRST handled in offset()

  const start = Number(offset) + 1;
  const end   = hasLimit ? Number(offset) + Number(limit) : null;

  return (
    `SELECT * FROM (SELECT inner__.*, ROW_NUMBER() OVER() AS "rn__" ` +
    `FROM (${inner}) AS inner__) AS outer__ ` +
    `WHERE "rn__" >= ${start}` +
    (end != null ? ` AND "rn__" <= ${end}` : '')
  );
}
```

### `forUpdate() → string`

DB2 uses `FOR UPDATE` or `FOR UPDATE WITH RS` (repeatable-read isolation).

```js
forUpdate() {
  return 'FOR UPDATE WITH RS';
}
```

### `forShare() → string`

DB2 uses `FOR FETCH ONLY` or `FOR READ ONLY` for read locks.

```js
forShare() {
  return 'FOR FETCH ONLY';
}
```

### `columnInfo() → object`

Returns a query object (with `.sql`, `.bindings`, and `.output`) that queries DB2 system catalog tables to describe a table's columns. In DB2 for z/OS the catalog is `SYSIBM.SYSCOLUMNS`.

```js
columnInfo() {
  const column = this.single.columnInfo;
  const table  = this.client.customWrapIdentifier(
    this.single.table,
    (v) => v  // identity — no quoting for catalog values
  ).toUpperCase(); // DB2 stores names in UPPERCASE

  const schema   = (this.single.schema || this.client.connectionSettings.currentSchema || '').toUpperCase();
  const bindings = [table];
  let sql = `SELECT NAME, COLTYPE, LENGTH, SCALE, NULLS, DEFAULT
             FROM SYSIBM.SYSCOLUMNS
             WHERE TBNAME = ?`;

  if (schema) {
    sql += ' AND TBCREATOR = ?';
    bindings.push(schema);
  }

  return {
    sql,
    bindings,
    output(resp) {
      const out = resp.reduce((cols, row) => {
        cols[row.NAME.trim()] = {
          type:         row.COLTYPE.trim(),
          maxLength:    row.LENGTH,
          scale:        row.SCALE,
          nullable:     row.NULLS === 'Y',
          defaultValue: row.DEFAULT,
        };
        return cols;
      }, {});
      return (column && out[column.toUpperCase()]) || out;
    },
  };
}
```

> **Important:** DB2 for z/OS stores all unquoted object names as UPPERCASE in the system catalog. Normalize table/column name inputs with `.toUpperCase()` when querying catalog tables.

### `whereLike() / whereILike()`

DB2 uses `LIKE` for case-insensitive comparison depending on the collation. DB2 for z/OS is case-sensitive by default. To implement case-insensitive `LIKE`, wrap the column in `UPPER()`:

```js
whereILike(statement) {
  return `UPPER(${this._columnClause(statement)}) ${this._not(statement, 'LIKE ')}UPPER(${this._valueClause(statement)})`;
}
```

### `with() / CTE`

DB2 for z/OS V9+ supports `WITH cte AS (...)` common table expressions. The base implementation generates standard CTE syntax and should work unchanged. Recursive CTEs (`WITH RECURSIVE`) use `WITH` + a self-referential union in DB2 (the `RECURSIVE` keyword is not used — identical to MSSQL).

```js
with() {
  // Strip 'recursive' keyword — DB2 does not use it
  const undoList = [];
  if (this.grouped.with) {
    for (const stmt of this.grouped.with) {
      if (stmt.recursive) {
        undoList.push(stmt);
        stmt.recursive = false;
      }
    }
  }
  const result = super.with();
  for (const stmt of undoList) stmt.recursive = true;
  return result;
}
```

### Clause prevalidation in current Knex

Current `QueryCompiler` runs `_preValidate()` before SQL generation. If DB2 permits or forbids a clause combination differently from the base class, plan to override `invalidClauses` on the prototype instead of silently generating SQL that discards user intent.

---

## 3. QueryBuilder (DML)

**Base class:** `lib/query/querybuilder.js`

In most cases you do **not** need a custom QueryBuilder for DB2. The base class implements all builder methods (`select`, `where`, `join`, `limit`, etc.) as chainable calls that push plain objects onto `this._statements`. The QueryCompiler then reads those objects.

Override `QueryBuilder` only if you need to:
- **Add** DB2-specific fluent methods
- **Normalize** DB2-only input into `_single` or `_statements`
- **Optionally fail fast** for unsupported builder methods, though rejecting them in the `QueryCompiler` constructor is usually simpler and more consistent with existing dialects
- **Add new DB2-specific builder methods** (e.g., `.isolation()`, `.queryOptimization()`)

If you do create a custom QueryBuilder, register it in your Client:

```js
const QueryBuilder = require('../../query/querybuilder');

class QueryBuilder_DB2ZOS extends QueryBuilder {
  // Example: DB2-specific OPTIMIZE FOR n ROWS hint
  optimizeFor(n) {
    this._single.optimizeFor = n;
    return this;
  }
}
```

Then in the QueryCompiler, read `this.single.optimizeFor` and append `OPTIMIZE FOR n ROWS` to the SELECT.

---

## 4. SchemaCompiler (DDL – Top Level)

**Base class:** `lib/schema/compiler.js`
**Analogous dialect:** MSSQL (`lib/dialects/mssql/schema/mssql-compiler.js`), PostgreSQL (`lib/dialects/postgres/schema/pg-compiler.js`)

`SchemaCompiler` handles the top-level DDL operations dispatched from `knex.schema.*`. It converts method names like `createTable`, `dropTable`, `hasTable` into SQL statements.

```js
const SchemaCompiler = require('../../../schema/compiler');

class SchemaCompiler_DB2ZOS extends SchemaCompiler {
  constructor(client, builder) {
    super(client, builder);
  }
}

// DB2 uses uppercase DROP TABLE by convention
SchemaCompiler_DB2ZOS.prototype.dropTablePrefix = 'DROP TABLE ';

module.exports = SchemaCompiler_DB2ZOS;
```

### Methods to override

#### `hasTable(tableName)`

Queries `SYSIBM.SYSTABLES` to check existence.

```js
hasTable(tableName) {
  const table    = tableName.toUpperCase();
  const schema   = (this.schema || this.client.connectionSettings.currentSchema || '').toUpperCase();
  const bindings = [table];

  let sql = `SELECT 1 FROM SYSIBM.SYSTABLES WHERE NAME = ? AND TYPE = 'T'`;
  if (schema) {
    sql += ' AND CREATOR = ?';
    bindings.push(schema);
  }

  this.pushQuery({
    sql,
    bindings,
    output: (resp) => resp.length > 0,
  });
}
```

#### `hasColumn(tableName, columnName)`

Queries `SYSIBM.SYSCOLUMNS`.

```js
hasColumn(tableName, columnName) {
  const table    = tableName.toUpperCase();
  const column   = columnName.toUpperCase();
  const schema   = (this.schema || this.client.connectionSettings.currentSchema || '').toUpperCase();
  const bindings = [table, column];

  let sql = `SELECT 1 FROM SYSIBM.SYSCOLUMNS WHERE TBNAME = ? AND NAME = ?`;
  if (schema) {
    sql += ' AND TBCREATOR = ?';
    bindings.push(schema);
  }

  this.pushQuery({
    sql,
    bindings,
    output: (resp) => resp.length > 0,
  });
}
```

#### `renameTable(from, to)`

DB2 for z/OS uses `RENAME TABLE old TO new` (V8+).

```js
renameTable(from, to) {
  this.pushQuery(
    `RENAME TABLE ${this.formatter.wrap(prefixedTableName(this.schema, from))} TO ${this.formatter.wrap(to)}`
  );
}
```

#### `dropTableIfExists(tableName)`

DB2 for z/OS does **not** support `DROP TABLE IF EXISTS`. You must check `SYSIBM.SYSTABLES` first, or catch the SQLCODE -204 error. Here is the safe approach using a conditional pattern:

```js
dropTableIfExists(tableName) {
  const name   = this.formatter.wrap(prefixedTableName(this.schema, tableName));
  const raw    = tableName.toUpperCase();
  const schema = (this.schema || '').toUpperCase();

  // Emit a conditional drop using a helper stored procedure pattern,
  // or check existence first. Some teams use a shell stored-procedure.
  // The simplest approach that works in a script context:
  this.pushQuery({
    sql: `BEGIN
            DECLARE CONTINUE HANDLER FOR SQLSTATE '42704' BEGIN END;
            EXECUTE IMMEDIATE 'DROP TABLE ${name}';
          END`,
    // Note: This is COMPOUND SQL (dynamic). Requires DB2 V9+.
    // For V8 compatibility, check SYSIBM.SYSTABLES in a separate query.
  });
}
```

> **DB2 z/OS alternative (pre-V9):** issue a `SELECT COUNT(*) FROM SYSIBM.SYSTABLES WHERE ...` check first, then conditionally issue `DROP TABLE`.

#### Schema / Collection operations

DB2 for z/OS uses **schemas** (called *collections* in earlier documentation). The base `createSchema` / `dropSchema` throw a "Postgres only" error. Override them:

```js
createSchema(schemaName) {
  // DB2 for z/OS: CREATE SCHEMA creates an implicit schema
  this.pushQuery(`CREATE SCHEMA ${this.formatter.wrap(schemaName)}`);
}

createSchemaIfNotExists(schemaName) {
  throw new Error('Use a stepwise migration pattern for db2-zos: check existence first in migration code, then issue CREATE SCHEMA separately.');
}

dropSchema(schemaName) {
  this.pushQuery(`DROP SCHEMA ${this.formatter.wrap(schemaName)} RESTRICT`);
}

dropSchemaIfExists(schemaName) {
  // Same issue as dropTableIfExists — no native IF EXISTS
  const name = this.formatter.wrap(schemaName);
  this.pushQuery({
    sql: `BEGIN
            DECLARE CONTINUE HANDLER FOR SQLSTATE '42704' BEGIN END;
            EXECUTE IMMEDIATE 'DROP SCHEMA ${name} RESTRICT';
          END`,
  });
}
```

#### `generateDdlCommands()`

The base `SchemaCompiler.generateDdlCommands()` returns `{ pre: [], sql: [...], check: null, post: [] }`. DB2 for z/OS sometimes requires commands to be issued in a specific order (e.g., auxiliary tables for LOB columns). Override this method if your driver needs to emit pre/post DDL.

### View support decision

Current Knex has first-class `ViewBuilder` / `ViewCompiler` support. The current direction is to include **basic view support** in phase 1:

- `createView`
- `dropView`

Treat these as follow-on items unless DB2 V11 behavior is validated and a real requirement appears:

- `createViewOrReplace`
- `alterView`

If DB2 view syntax is sufficiently standard, a DB2 dialect may be able to reuse the base `ViewCompiler` unchanged. If not, add a dedicated DB2 view compiler rather than letting view APIs fail in surprising ways.

---

## 5. TableCompiler (DDL – Table Level)

**Base class:** `lib/schema/tablecompiler.js`
**Analogous dialects:** MSSQL (`lib/dialects/mssql/schema/mssql-tablecompiler.js`), Oracle (`lib/dialects/oracle/schema/oracle-tablecompiler.js`)

`TableCompiler` builds the DDL for individual tables — `CREATE TABLE`, `ALTER TABLE`, and all index/constraint operations.

### Prototype properties (override on the prototype)

```js
TableCompiler_DB2ZOS.prototype.lowerCase            = false; // DB2 uses UPPERCASE keywords
TableCompiler_DB2ZOS.prototype.addColumnsPrefix     = 'ADD COLUMN ';
TableCompiler_DB2ZOS.prototype.alterColumnsPrefix   = 'ALTER COLUMN ';
TableCompiler_DB2ZOS.prototype.dropColumnPrefix     = 'DROP COLUMN ';
// Methods that should be inlined in CREATE TABLE rather than separate ALTER TABLE:
TableCompiler_DB2ZOS.prototype.createAlterTableMethods = ['foreign', 'primary'];
```

### `createQuery(columns, ifNot, like)`

Emits the `CREATE TABLE` statement.

```js
createQuery(columns, ifNot, like) {
  let createStatement = 'CREATE TABLE ';

  if (like) {
    // DB2 for z/OS does not have CREATE TABLE ... LIKE with including constraints.
    // Use: CREATE TABLE new AS (SELECT * FROM old) WITH NO DATA
    createStatement += `${this.tableName()} AS (SELECT * FROM ${this.tableNameLike()}) WITH NO DATA`;
  } else {
    createStatement +=
      this.tableName() +
      (this._formatting ? ' (\n    ' : ' (') +
      columns.sql.join(this._formatting ? ',\n    ' : ', ') +
      this._addChecks() +
      ')';
  }

  this.pushQuery(createStatement);

  if (this.single.comment) this.comment(this.single.comment);
  if (like) this.addColumns(columns, this.addColumnsPrefix);
}
```

> **DB2 for z/OS note:** `IF NOT EXISTS` is not valid in `CREATE TABLE`. Use the `hasTable()` check on `SchemaCompiler` before issuing `createTable`.

### `comment(comment)`

DB2 for z/OS uses `COMMENT ON TABLE ... IS '...'`.

```js
comment(comment) {
  this.pushQuery(
    `COMMENT ON TABLE ${this.tableName()} IS '${comment.replace(/'/g, "''")}'`
  );
}
```

### `addColumns(columns, prefix)`

DB2 requires one `ALTER TABLE ... ADD COLUMN` per column (unlike PostgreSQL which allows multiple in one statement, and MySQL which allows them separated by commas). DB2 V10+ allows multiple columns in one `ADD`:

```js
addColumns(columns, prefix) {
  if (columns.sql.length === 0) return;
  prefix = prefix || this.addColumnsPrefix;

  // DB2 V10+: ALTER TABLE t ADD COLUMN c1 ..., ADD COLUMN c2 ...
  // DB2 pre-V10: one ALTER TABLE per column
  columns.sql.forEach((col) => {
    this.pushQuery({
      sql: `ALTER TABLE ${this.tableName()} ${prefix}${col}`,
      bindings: columns.bindings,
    });
  });
}
```

### `alterColumns(columns, colBuilders)`

DB2 uses `ALTER TABLE ... ALTER COLUMN col SET DATA TYPE ...` for type changes and `ALTER COLUMN col SET DEFAULT ...` for default changes. The alter syntax differs significantly:

```js
alterColumns(columns, colBuilders) {
  columns.sql.forEach((sql, i) => {
    this.pushQuery({
      sql: `ALTER TABLE ${this.tableName()} ALTER COLUMN ${sql}`,
      bindings: columns.bindings,
    });
  });
}
```

### `dropColumn()`

```js
dropColumn() {
  const columns = require('../../../util/helpers').normalizeArr.apply(null, arguments);
  columns.forEach((column) => {
    this.pushQuery(`ALTER TABLE ${this.tableName()} DROP COLUMN ${this.formatter.wrap(column)}`);
  });
}
```

> **DB2 z/OS note:** After dropping a column, a `REORG TABLE` is required for the change to take physical effect. You may want to push a `CALL SYSPROC.ADMIN_REORG_TABLE(...)` or document this requirement.

### `renameColumn(from, to)`

DB2 for z/OS supports `ALTER TABLE t ALTER COLUMN old RENAME TO new` (V11+). Pre-V11 requires add + copy + drop.

```js
renameColumn(from, to) {
  this.pushQuery(
    `ALTER TABLE ${this.tableName()} RENAME COLUMN ${this.formatter.wrap(from)} TO ${this.formatter.wrap(to)}`
  );
}
```

### `primary(columns, constraintName)`

```js
primary(columns, constraintName) {
  constraintName = constraintName
    ? this.formatter.wrap(constraintName)
    : this.formatter.wrap(`${this.tableNameRaw}_PKEY`);

  if (!this.forCreate) {
    this.pushQuery(
      `ALTER TABLE ${this.tableName()} ADD CONSTRAINT ${constraintName} PRIMARY KEY (${this.formatter.columnize(columns)})`
    );
  } else {
    this.pushQuery(
      `CONSTRAINT ${constraintName} PRIMARY KEY (${this.formatter.columnize(columns)})`
    );
  }
}
```

### `unique(columns, indexName)`

DB2 for z/OS unique constraints are inline with the table or via `CREATE UNIQUE INDEX`. Note that unique *indexes* on nullable columns allow multiple NULLs (like Postgres).

```js
unique(columns, indexName) {
  indexName = indexName
    ? this.formatter.wrap(indexName)
    : this._indexCommand('UNIQUE', this.tableNameRaw, columns);

  if (!this.forCreate) {
    this.pushQuery(
      `CREATE UNIQUE INDEX ${indexName} ON ${this.tableName()} (${this.formatter.columnize(columns)})`
    );
  } else {
    this.pushQuery(
      `CONSTRAINT ${indexName} UNIQUE (${this.formatter.columnize(columns)})`
    );
  }
}
```

### `index(columns, indexName, options)`

```js
index(columns, indexName, options) {
  indexName = indexName
    ? this.formatter.wrap(indexName)
    : this._indexCommand('INDEX', this.tableNameRaw, columns);

  this.pushQuery(
    `CREATE INDEX ${indexName} ON ${this.tableName()} (${this.formatter.columnize(columns)})`
  );
}
```

### `dropIndex(columns, indexName)`

DB2 uses `DROP INDEX indexName` (no `ON table`).

```js
dropIndex(columns, indexName) {
  indexName = indexName
    ? this.formatter.wrap(indexName)
    : this._indexCommand('INDEX', this.tableNameRaw, columns);
  this.pushQuery(`DROP INDEX ${indexName}`);
}
```

### `dropUnique(column, indexName)` / `dropForeign(columns, indexName)` / `dropPrimary(constraintName)`

All use `ALTER TABLE ... DROP CONSTRAINT`:

```js
dropUnique(column, indexName) {
  indexName = indexName
    ? this.formatter.wrap(indexName)
    : this._indexCommand('UNIQUE', this.tableNameRaw, column);
  this.pushQuery(`DROP INDEX ${indexName}`);
}

dropForeign(columns, indexName) {
  indexName = indexName
    ? this.formatter.wrap(indexName)
    : this._indexCommand('FOREIGN', this.tableNameRaw, columns);
  this.pushQuery(`ALTER TABLE ${this.tableName()} DROP FOREIGN KEY ${indexName}`);
}

dropPrimary(constraintName) {
  constraintName = constraintName
    ? this.formatter.wrap(constraintName)
    : this.formatter.wrap(`${this.tableNameRaw}_PKEY`);
  this.pushQuery(`ALTER TABLE ${this.tableName()} DROP PRIMARY KEY`);
  // DB2 drops the PK by name or just DROP PRIMARY KEY (there can only be one)
}
```

### `_setNullableState(column, isNullable)`

DB2 uses `ALTER COLUMN col SET NOT NULL` / `ALTER COLUMN col DROP NOT NULL` but only from V11. Earlier versions need a different approach (recreating the column).

```js
_setNullableState(column, isNullable) {
  const colName = this.formatter.columnize(column);
  const action  = isNullable ? 'DROP NOT NULL' : 'SET NOT NULL';
  this.pushQuery(`ALTER TABLE ${this.tableName()} ALTER COLUMN ${colName} ${action}`);
}
```

---

## 6. ColumnCompiler (DDL – Column Level)

**Base class:** `lib/schema/columncompiler.js`
**Analogous dialects:** MSSQL (`lib/dialects/mssql/schema/mssql-columncompiler.js`), Oracle (`lib/dialects/oracle/schema/oracle-columncompiler.js`)

`ColumnCompiler` translates Knex's abstract column types and modifiers into DB2-specific SQL fragments. Each column type method returns a DB2 type string.

### Constructor / modifiers list

```js
class ColumnCompiler_DB2ZOS extends ColumnCompiler {
  constructor(client, tableCompiler, columnBuilder) {
    super(client, tableCompiler, columnBuilder);
    // Order matters — these are applied left to right to build the column DDL
    this.modifiers = ['nullable', 'defaultTo', 'generated', 'comment'];
    this._addCheckModifiers(); // adds check*, checkPositive, checkNegative, etc.
  }
}
```

### Data type mappings

The following table maps Knex abstract types to a **recommended initial DB2 for z/OS strategy**. Several of these are design choices rather than universally correct answers for all z/OS releases.

| Knex method | DB2 for z/OS type | Notes |
|---|---|---|
| `increments(name)` | `INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1)` | Identity column; primary key added separately |
| `bigincrements(name)` | `BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1)` | |
| `integer(name)` | `INTEGER` | |
| `smallint(name)` | `SMALLINT` | |
| `tinyint(name)` | `SMALLINT` | DB2 has no TINYINT |
| `mediumint(name)` | `INTEGER` | DB2 has no MEDIUMINT |
| `biginteger(name)` | `BIGINT` | |
| `float(name, p, s)` | `FLOAT(p)` or `REAL` | |
| `double(name, p, s)` | `DOUBLE` | |
| `decimal(name, p, s)` | `DECIMAL(p, s)` | |
| `boolean(name)` | `SMALLINT` + CHECK (col IN (0,1)) | DB2 for z/OS has no BOOLEAN |
| `string(name, length)` | `VARCHAR(length)` | |
| `varchar(name, length)` | `VARCHAR(length)` | |
| `char(name, length)` | `CHAR(length)` | |
| `text(name)` | `CLOB(32000)` | Or `VARCHAR(32672)` for short text |
| `mediumtext(name)` | `CLOB(16M)` | |
| `longtext(name)` | `CLOB(2G)` | |
| `binary(name, length)` | `BLOB` | Conservative phase-1 choice |
| `date(name)` | `DATE` | |
| `datetime(name)` | `TIMESTAMP` | DB2 has no DATETIME; use TIMESTAMP |
| `time(name)` | `TIME` | |
| `timestamp(name)` | `TIMESTAMP` | Do not support `useTz` in phase 1 |
| `json(name)` | `CLOB(2M)` | Conservative phase-1 storage strategy |
| `jsonb(name)` | `CLOB(2M)` | Same as json |
| `uuid(name)` | `CHAR(36)` | DB2 has no native UUID type |
| `enu(name, values)` | `VARCHAR(max_val_len)` + CHECK (col IN (...)) | |
| `bit(name, length)` | `CHAR(n) FOR BIT DATA` | |
| `geometry / geography / point` | Not natively supported | Use `BLOB` or third-party spatial extension |

Implement the type methods:

```js
increments(options = { primaryKey: true }) {
  return (
    'INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1)' +
    (this.tableCompiler._canBeAddPrimaryKey(options) ? ' PRIMARY KEY' : '')
  );
}

bigincrements(options = { primaryKey: true }) {
  return (
    'BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1)' +
    (this.tableCompiler._canBeAddPrimaryKey(options) ? ' PRIMARY KEY' : '')
  );
}

varchar(length) {
  return `VARCHAR(${toNumber(length, 255)})`;
}

decimal(precision, scale) {
  if (precision === null) return 'DECIMAL';
  return `DECIMAL(${toNumber(precision, 8)}, ${toNumber(scale, 2)})`;
}

floating(precision, scale) {
  return `FLOAT(${toNumber(precision, 8)})`;
}

double() {
  return 'DOUBLE';
}

timestamp({ useTz = false } = {}) {
  if (useTz) {
    throw new Error('timestamp({ useTz: true }) must be version-validated before enabling for db2-zos.');
  }
  return 'TIMESTAMP';
}

datetime({ useTz = false } = {}) {
  return this.timestamp({ useTz });
}

bool() {
  // No native BOOLEAN in DB2 for z/OS
  this.columnBuilder._modifiers.checkIn = [[0, 1]];
  return 'SMALLINT';
}

enu(allowed) {
  const maxLength = allowed.reduce((m, v) => Math.max(m, String(v).length), 1);
  this.columnBuilder._modifiers.checkIn = [allowed];
  return `VARCHAR(${maxLength})`;
}

uuid({ useBinaryUuid = false } = {}) {
  return useBinaryUuid ? 'BINARY(16)' : 'CHAR(36)';
}
```

Set the simple type aliases on the prototype:

```js
ColumnCompiler_DB2ZOS.prototype.integer   = 'INTEGER';
ColumnCompiler_DB2ZOS.prototype.tinyint   = 'SMALLINT';
ColumnCompiler_DB2ZOS.prototype.smallint  = 'SMALLINT';
ColumnCompiler_DB2ZOS.prototype.mediumint = 'INTEGER';
ColumnCompiler_DB2ZOS.prototype.biginteger = 'BIGINT';
ColumnCompiler_DB2ZOS.prototype.text      = 'CLOB(32000)';
ColumnCompiler_DB2ZOS.prototype.mediumtext = 'CLOB(16M)';
ColumnCompiler_DB2ZOS.prototype.longtext  = 'CLOB(2G)';
ColumnCompiler_DB2ZOS.prototype.json      = 'CLOB(2M)';
ColumnCompiler_DB2ZOS.prototype.jsonb     = 'CLOB(2M)';
ColumnCompiler_DB2ZOS.prototype.date      = 'DATE';
ColumnCompiler_DB2ZOS.prototype.time      = 'TIME';
ColumnCompiler_DB2ZOS.prototype.bit       = 'CHAR(1) FOR BIT DATA';
ColumnCompiler_DB2ZOS.prototype.binary    = 'BLOB';
ColumnCompiler_DB2ZOS.prototype.bool      = 'SMALLINT'; // overridden by method above
```

### Modifiers

#### `nullable(value)`

DB2 uses the standard `NOT NULL` / `NULL` syntax. The base implementation is correct:

```js
// Inherited from base — returns 'not null' or 'null'
```

#### `defaultTo(value)`

The base implementation calls `formatDefault()` which handles booleans, strings, `null`, and `knex.raw()`. DB2 accepts `DEFAULT value` as standard syntax. Override only if you need to handle DB2-specific defaults like `DEFAULT CURRENT_TIMESTAMP`.

```js
defaultTo(value) {
  // knex.raw('CURRENT TIMESTAMP') works without override.
  // The base formatDefault() is sufficient in most cases.
  return super.defaultTo(value);
}
```

#### `comment(comment)`

DB2 for z/OS uses a separate `COMMENT ON COLUMN table.col IS '...'` statement, emitted as an additional query via `pushAdditional`.

```js
comment(comment) {
  const columnName = this.args[0] || this.defaults('columnName');
  this.pushAdditional(function () {
    this.pushQuery(
      `COMMENT ON COLUMN ${this.tableCompiler.tableName()}.` +
      this.formatter.wrap(columnName) +
      ` IS '${(comment || '').replace(/'/g, "''")}'`
    );
  }, comment);
  return '';
}
```

#### `generated` (GENERATED ALWAYS/BY DEFAULT)

DB2 supports generated columns. If you expose a custom `.generatedAs(expression)` builder method, handle it here:

```js
generated(expr) {
  return `GENERATED ALWAYS AS (${expr})`;
}
```

---

## 7. Transaction

**Base class:** `lib/execution/transaction.js`

Current Knex **does** issue SQL transaction statements in the base `Transaction` implementation: `BEGIN`, `SAVEPOINT`, `RELEASE SAVEPOINT`, `COMMIT`, and `ROLLBACK`. For this dialect, do **not** use that SQL-text behavior as the final DB2 strategy.

The plan is to add a DB2-specific `Transaction` subclass and route top-level transaction management through `ibm_db` transaction APIs.

Why:

- `ibm_db` is the chosen driver
- `ibm_db` publicly documents only `beginTransaction`, `commitTransaction`, `rollbackTransaction`, and isolation-setting APIs
- this avoids relying on SQL transaction text whose exact support may vary in the target environment

What the upstream driver docs show today:

- `beginTransaction()` / `beginTransactionSync()`
- `commitTransaction()` / `commitTransactionSync()`
- `rollbackTransaction()` / `rollbackTransactionSync()`
- `setIsolationLevel()`

What they do **not** document:

- savepoint APIs
- nested transaction APIs
- any driver-managed transaction stack

The driver implementation also matches that public surface: `beginTransaction` turns autocommit off at the connection level, and commit/rollback end the connection transaction. That is useful for Knex top-level transactions, but it is **not evidence of native nested transaction support**.

Initial shape:

```js
const Transaction = require('../../execution/transaction');

class Transaction_DB2ZOS extends Transaction {
  async begin(connection) {
    // ibm_db begins a top-level transaction by disabling autocommit
    // on the connection handle.
    connection.beginTransaction((err) => { /* ... */ });
  }

  async commit(connection, value) {
    return new Promise((resolve, reject) => {
      connection.commitTransaction((err) => {
        if (err) return reject(err);
        resolve(value);
      });
    });
  }

  async rollback(connection, error) {
    return new Promise((resolve, reject) => {
      connection.rollbackTransaction((err) => {
        if (err) return reject(err);
        resolve(error);
      });
    });
  }
}
```

### Isolation levels

DB2 for z/OS isolation levels map to standard SQL terms but use different names internally:

| Standard SQL | DB2 for z/OS name | DB2 BIND option |
|---|---|---|
| Read Uncommitted | Uncommitted Read (UR) | `ISOLATION(UR)` |
| Read Committed | Cursor Stability (CS) | `ISOLATION(CS)` |
| Repeatable Read | Read Stability (RS) | `ISOLATION(RS)` |
| Serializable | Repeatable Read (RR) | `ISOLATION(RR)` |

Knex uses SQL transaction control in the base implementation. In DB2 for z/OS, isolation is also influenced by the **package/plan bind level** and sometimes by statement-level clauses like `WITH UR/CS/RS/RR`.

Because of that, isolation support should be treated as an explicit design decision:

- either support only the subset that maps cleanly to DB2
- or reject `config.isolationLevel` values that cannot be honored reliably

For nested transactions, the current evidence does **not** support claiming native `ibm_db` support. If Knex phase 1 needs nested transactions, treat them as a separate capability that would need explicit `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` / `RELEASE SAVEPOINT` SQL validation on the target DB2 z/OS V11 environment.

That means the safer plan is:

- support top-level transactions in phase 1 via `ibm_db`
- defer nested transactions until real savepoint behavior is verified end-to-end

If nested transaction support is later required, override the transaction methods directly and validate them with integration tests rather than assuming the driver provides them natively:

```js
// In Transaction_DB2ZOS:
savepoint(conn) {
  return this.query(conn, `SAVEPOINT ${this.txid} ON ROLLBACK RETAIN CURSORS`);
}

release(conn, value) {
  return this.query(conn, `RELEASE SAVEPOINT ${this.txid}`, 1, value);
}

rollbackTo(conn, error) {
  return this.query(conn, `ROLLBACK TO SAVEPOINT ${this.txid}`, 2, error);
}
```

> **Note:** DB2 for z/OS supports savepoints from V8, but the current `ibm_db` documentation does not expose savepoint helpers. Any nested-transaction claim for this dialect should therefore be based on validated SQL savepoint behavior, not on assumed driver-native support.

---

## 8. Formatter / Identifier Quoting

**Base class:** `lib/formatter.js`

The Formatter is used internally by compilers for wrapping identifiers and handling schema-prefixed names. You rarely need to subclass it.

### Identifier rules for DB2 for z/OS

- Object names that are **unquoted** are folded to **UPPERCASE** by DB2.
- Object names that are **double-quoted** preserve case exactly.
- The current plan for this dialect is to emit **plain unquoted identifiers** by default.

```js
wrapIdentifierImpl(value) {
  return value === '*' ? '*' : value;
}
```

That keeps generated SQL simpler and avoids introducing quoted, case-sensitive names as the default behavior. The tradeoff is that reserved words, special characters, and intentionally mixed-case identifiers are out of scope for a conservative phase-1 dialect.

### Schema / three-part names

DB2 for z/OS does not support three-part (database.schema.table) names the same way SQL Server does. The equivalent is `schema.table` (two-part). The `withSchema()` call on `SchemaBuilder` / `QueryBuilder` provides the schema prefix, and `formatter.wrap()` handles schema-qualified names correctly in the base implementation.

---

## 9. Wire Protocol / Runner Hooks

Beyond the Client methods described above, the Runner (`lib/execution/runner.js`) calls these hooks if you define them:

| Hook | When called | Notes |
|---|---|---|
| `_query(conn, queryObj)` | Every SQL statement | **Required.** Set `queryObj.response`. |
| `_stream(conn, queryObj, stream)` | Streaming queries | Implement for `.stream()` support |
| `processResponse(queryObj, runner)` | After `_query` returns | **Required.** Map raw rows → Knex result |
| `processPassedConnection(conn)` | When user passes a raw connection | Optional cleanup |

For DB2 planning, also keep these adjacent hooks in scope even though Runner does not call them directly:

- `prepBindings()` if the driver needs bind-value normalization
- `positionBindings()` if the driver does **not** accept literal `?` placeholders
- `postProcessResponse()` if the dialect depends on repo-wide response shaping

For **ibm_db**:

```js
_query(connection, queryObject) {
  return new Promise((resolve, reject) => {
    const { sql, bindings } = queryObject;
    connection.query(sql, bindings || [], (err, result) => {
      if (err) return reject(err);
      queryObject.response = Array.isArray(result) ? result : [];
      resolve(queryObject);
    });
  });
}
```

---

## 10. File Layout Recommendation

```
lib/dialects/db2-zos/
├── index.js                            ← Client_DB2ZOS
├── transaction.js                      ← Transaction_DB2ZOS
├── db2zos-formatter.js                 ← (optional) Formatter subclass
├── query/
│   └── db2zos-querycompiler.js         ← QueryCompiler_DB2ZOS
│   └── db2zos-querybuilder.js          ← (optional) QueryBuilder_DB2ZOS
└── schema/
    ├── db2zos-compiler.js              ← SchemaCompiler_DB2ZOS
    ├── db2zos-tablecompiler.js         ← TableCompiler_DB2ZOS
    ├── db2zos-columncompiler.js        ← ColumnCompiler_DB2ZOS
    ├── db2zos-columnbuilder.js         ← (optional) ColumnBuilder_DB2ZOS
    ├── db2zos-viewcompiler.js          ← (optional) ViewCompiler_DB2ZOS
    └── db2zos-viewbuilder.js           ← (optional) ViewBuilder_DB2ZOS
```

---

## 11. Registration / Usage

### Register as a named client

```js
// In lib/dialects/index.js and lib/dialects/index.ts
// add the db2-zos loader to dbNameToDialectLoader:
'db2-zos': () => require('./db2-zos')
```

Because this repository keeps both JavaScript and TypeScript dialect registries, update both files together.

### Use it

```js
const knex = require('knex');

const db = knex({
  client: 'db2-zos',   // OR pass the class directly: client: require('./lib/dialects/db2-zos')
  connection: {
    host:           'DB2HOST.example.com',
    port:           446,        // SSL/TLS port; standard is 50000
    database:       'DSNDB06',  // DB2 subsystem / location name
    user:           'MYUSER',
    password:       'MYPASS',
    currentSchema:  'MYSCHEMA', // SET CURRENT SCHEMA equivalent
  },
  pool: { min: 2, max: 10 },
});
```

### Connection string for ibm_db

The `ibm_db` driver uses a DSN-style connection string:

```js
acquireRawConnection() {
  const c = this.connectionSettings;
  const connStr =
    `DATABASE=${c.database};` +
    `HOSTNAME=${c.host};` +
    `PORT=${c.port || 446};` +
    `PROTOCOL=TCPIP;` +
    `UID=${c.user};` +
    `PWD=${c.password};` +
    (c.currentSchema ? `CURRENTSCHEMA=${c.currentSchema};` : '');

  return new Promise((resolve, reject) => {
    this.driver.open(connStr, (err, conn) => {
      if (err) return reject(err);
      conn.__knexUid = require('lodash/uniqueId')('__knexUid');
      resolve(conn);
    });
  });
}
```

---

## 12. Repository Integration Checklist

Treat the following as part of the dialect definition of done for this repository.

### Runtime registration

- Add the dialect loader to `lib/dialects/index.js`
- Add the same loader to `lib/dialects/index.ts`
- Ensure the dialect can be constructed via `client: 'db2-zos'` and via passing the class directly

### Query and schema behavior

- Include basic view support (`createView`, `dropView`) if DB2 V11 syntax stays close enough to the base compiler
- `.returning()` remains open and needs a specific policy decision
- Minimum supported DB2 for z/OS release baseline: Version 11
- Identifier policy: emit plain unquoted identifiers; do not auto-uppercase in Knex

### Test harness integration

- Add a `db2-zos` entry to `test/knexfile.js`
- Add instance-provider wiring where integration suites enumerate supported dialects
- Add unit tests covering query compilation, schema compilation, transaction behavior, and response processing
- Add integration coverage for the subset of features the first milestone claims to support

### Documentation and maintenance

- Document required external driver installation (`ibm_db`)
- Document unsupported features explicitly instead of leaving behavior ambiguous
- Add a short user-facing guide once the dialect exists, separate from this internal planning document

---

## 13. Validation Backlog Before Coding

These are the highest-value questions to answer before implementation if the goal is at least 95% confidence that the plan is complete and correct.

1. Driver choice: `ibm_db`.
  This is now fixed for the plan.

2. DB2 for z/OS release baseline: Version 11.
  This is now fixed for the plan, and offset handling should assume `ROW_NUMBER()`-based emulation.

3. Define `.returning()` policy.
  Clarification:
  - Reject `.returning()` entirely in phase 1. This is the safest and simplest option.
  - Support only single-row identity retrieval after insert, likely via a follow-up identity query. This is narrower than Knex users typically expect from `.returning()`.
  - Attempt broad emulation for insert/update/delete. This is high-risk and not recommended for phase 1.

  Recommended choice: reject `.returning()` in phase 1 and document that clearly.

4. Define identifier policy.
  Decision: emit plain unquoted identifiers and do not auto-uppercase in Knex.
  Consequence: DB2 will still resolve those names using its normal unquoted identifier rules, so effectively they map to uppercase internally.

5. Verify schema conditional DDL strategy.
  Decision: do not use compound SQL. Use a two-step migration pattern instead.

6. Verify binary, JSON, and time-zone column strategy.
  Clarification and recommendation:
  - Binary: use `BLOB` in phase 1. It is less elegant than bit-data variants, but simpler and lower-risk.
  - JSON / JSONB: store as `CLOB(2M)` in phase 1 and leave JSON semantics to application code.
  - Time-zone timestamps: do not support `useTz` in phase 1. Map both `datetime` and `timestamp` to plain `TIMESTAMP`.

7. Decide whether views are phase-1 scope.
  Current direction: yes, but only for basic support.
  Recommended phase-1 view scope:
  - `createView`
  - `dropView`
  Exclude initially unless verified:
  - `createViewOrReplace`
  - `alterView`
  This keeps the view milestone useful without dragging in non-essential dialect complexity.

8. Confirm savepoint syntax against the target environment.
  Decision: rely on `ibm_db` transaction management for top-level transactions only.
  Updated guidance: current `ibm_db` documentation does not expose savepoint or nested-transaction APIs, so nested transaction support should remain out of scope until SQL savepoint behavior is validated directly on the target environment.

9. Plan for REORG-sensitive DDL.
  Clarification and recommendation:
  - Documentation-only: warn that some DDL leaves objects REORG-pending and let operators handle it. Recommended for phase 1.
  - Opt-in helper: expose a documented raw call or follow-up operational step in migrations.
  - Automatic REORG: high-risk, operationally intrusive, and not recommended for phase 1.

  Recommended choice: document REORG as an operational follow-up for affected DDL, not something Knex automates.

10. Define the first supported feature envelope.
  A credible phase-1 target would be: core select/insert/update/delete, transactions, basic schema create/alter/drop, indexes, comments, and catalog-backed `hasTable` / `hasColumn` / `columnInfo`.

## 14. Quick-Reference: DB2 for z/OS SQL Specifics

This section is a concise cheat sheet of the most important DB2 for z/OS SQL differences versus standard SQL or other databases, grouped by the compiler layer they affect.

### DML (QueryCompiler)

| Feature | DB2 for z/OS syntax | Notes |
|---|---|---|
| Parameter placeholder | `?` | `ibm_db` accepts `?` |
| Identifier delimiter | Unquoted identifier | Current plan is to emit plain identifiers; DB2 resolves unquoted names using its normal rules |
| Row limiting | `FETCH FIRST n ROWS ONLY` | Suitable for the V11 baseline |
| Offset on V11 | `ROW_NUMBER() OVER()` subquery wrap | Use this for supported baseline portability |
| FOR UPDATE | `FOR UPDATE WITH RS` | RS = Read Stability |
| FOR READ | `FOR FETCH ONLY` | |
| Truncate | `TRUNCATE TABLE t IMMEDIATE` | V9+; older: `DELETE FROM t` |
| CTE | `WITH cte AS (...)` | No `RECURSIVE` keyword needed |
| INSERT default | Validate `DEFAULT VALUES` behavior on the target release | Fallback may require a dialect override or a documented limitation |
| RETURNING/OUTPUT | Treat as unsupported in phase 1 | If later emulated, scope it narrowly to identity retrieval and document limits |
| MERGE (upsert) | `MERGE INTO target USING source ON (...) WHEN MATCHED THEN ... WHEN NOT MATCHED THEN ...` | DB2 V8+ |
| JSON functions | Not a phase-1 goal | Keep JSON semantics in application code initially |
| JSON storage | `CLOB(2M)` | |
| `DISTINCT ON` | Not supported | Use subquery |
| `ILIKE` | Not supported | Use `UPPER(col) LIKE UPPER(val)` |
| `||` string concat | Supported | |
| `CURRENT_TIMESTAMP` | `CURRENT TIMESTAMP` (no parentheses) | |
| `CURRENT_DATE` | `CURRENT DATE` | |
| `CURRENT_TIME` | `CURRENT TIME` | |

### DDL (Schema / Table / Column Compilers)

| Feature | DB2 for z/OS syntax | Notes |
|---|---|---|
| Create table | `CREATE TABLE schema.name (...)` | No `IF NOT EXISTS` |
| Drop table | `DROP TABLE name` | No `IF EXISTS`; use stepwise existence checks in migrations or catch -204 |
| Drop column | `ALTER TABLE t DROP COLUMN col` | Requires REORG after |
| Rename column (V11+) | `ALTER TABLE t RENAME COLUMN old TO new` | |
| Rename column (pre-V11) | Add new + copy data + drop old | |
| Add column | `ALTER TABLE t ADD COLUMN col type` | One per statement pre-V10; multiple allowed V10+ |
| Alter column type | `ALTER TABLE t ALTER COLUMN col SET DATA TYPE type` | |
| Set/drop NOT NULL | `ALTER TABLE t ALTER COLUMN col SET NOT NULL` / `DROP NOT NULL` | V11+ |
| Auto-increment | `GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1)` | Per column |
| Boolean | `SMALLINT` with `CHECK (col IN (0,1))` | No native BOOLEAN |
| UUID | `CHAR(36)` | No native UUID type |
| JSON column | `CLOB(2M)` | Use a proven native type only after validating it on the chosen release |
| Index | `CREATE [UNIQUE] INDEX name ON schema.table (cols)` | |
| Drop index | `DROP INDEX name` | No `ON table` clause |
| Primary key | `CONSTRAINT name PRIMARY KEY (cols)` | |
| Foreign key | `CONSTRAINT name FOREIGN KEY (col) REFERENCES table(col) ON DELETE ... ON UPDATE ...` | |
| Table comment | `COMMENT ON TABLE t IS '...'` | |
| Column comment | `COMMENT ON COLUMN t.col IS '...'` | |
| Rename table | `RENAME TABLE old TO new` | |
| Create schema | `CREATE SCHEMA name` | |
| Drop schema | `DROP SCHEMA name RESTRICT` | RESTRICT = fail if objects exist; RESTRICT is the only option in z/OS |
| Savepoint | `SAVEPOINT name ON ROLLBACK RETAIN CURSORS` | Validate direct SQL behavior on the target V11 environment before claiming nested transaction support |
| Release savepoint | `RELEASE SAVEPOINT name` | No documented `ibm_db` helper API |
| Rollback to savepoint | `ROLLBACK TO SAVEPOINT name` | No documented `ibm_db` helper API |
| Check if table exists | `SELECT 1 FROM SYSIBM.SYSTABLES WHERE NAME='T' AND CREATOR='S' AND TYPE='T'` | |
| Check if column exists | `SELECT 1 FROM SYSIBM.SYSCOLUMNS WHERE TBNAME='T' AND NAME='C'` | |
| Column info | `SELECT NAME, COLTYPE, LENGTH, SCALE, NULLS, DEFAULT FROM SYSIBM.SYSCOLUMNS WHERE TBNAME=?` | |

### Catalog Tables

| Knex need | DB2 for z/OS catalog table | Key columns |
|---|---|---|
| Table existence | `SYSIBM.SYSTABLES` | `NAME`, `CREATOR`, `TYPE` ('T' = table) |
| Column info | `SYSIBM.SYSCOLUMNS` | `TBNAME`, `TBCREATOR`, `NAME`, `COLTYPE`, `LENGTH`, `SCALE`, `NULLS`, `DEFAULT` |
| Index info | `SYSIBM.SYSINDEXES` | `NAME`, `TBNAME`, `TBCREATOR`, `UNIQUERULE` |
| Constraint info | `SYSIBM.SYSTABCONST` | `CONSTNAME`, `TBNAME`, `TBCREATOR`, `TYPE` |
| Schema existence | `SYSIBM.SYSSCHEMAS` | `SCHEMANAME` |
| View existence | `SYSIBM.SYSVIEWS` | `NAME`, `CREATOR` |

---

## Additional Notes and Caveats

### REORG requirement

Many DDL changes on DB2 for z/OS (dropping columns, altering column types) leave the table in a "REORG pending" state. Subsequent DML on the table may fail with `SQL0668N`. You should document that users must run `CALL SYSPROC.ADMIN_REORG_TABLE(tableName)` or `REORG TABLESPACE` after certain schema alterations. You may optionally push a REORG call after relevant DDL in the TableCompiler.

### Sequence vs. IDENTITY

Older DB2 for z/OS applications use explicit `CREATE SEQUENCE` objects. IDENTITY columns (the `GENERATED ALWAYS AS IDENTITY` syntax) were introduced in V8 and are the recommended approach for new code. The `increments()` column type should use IDENTITY.

### LOB columns

`TEXT`, `BLOB`, `CLOB` columns in DB2 for z/OS require an **auxiliary table** and **auxiliary index** to be created alongside the base table. This is an automatic process in modern DB2 versions but requires attention:
- LOB columns must specify a LOB table space in older configurations.
- `CLOB(32000)` or smaller actually fits in the base row without an auxiliary table.
- `CLOB(32001)` or larger requires an auxiliary table.

### Package / Plan binding

DB2 for z/OS applications run through a **package** that is bound to the subsystem. When using a Node.js driver via DRDA (distributed), this is handled automatically, but static SQL plans require explicit `BIND PACKAGE`. Dynamic SQL (which is what Knex generates) does not require pre-binding.

### Special registers

These DB2 for z/OS special registers are useful in Knex `raw()` calls:

| Register | Description |
|---|---|
| `CURRENT DATE` | Current date |
| `CURRENT TIME` | Current time |
| `CURRENT TIMESTAMP` | Current timestamp |
| `CURRENT SCHEMA` | Current default schema |
| `CURRENT USER` | Current authorization ID |
| `CURRENT SERVER` | Connected location name |
| `IDENTITY_VAL_LOCAL()` | Last generated identity value |
| `CURRENT ISOLATION` | Current isolation level |

Example:

```js
// Use CURRENT TIMESTAMP as a default
knex.schema.createTable('events', (t) => {
  t.timestamp('created_at').defaultTo(knex.raw('CURRENT TIMESTAMP'));
});
```

### Naming length limits

DB2 for z/OS imposes strict identifier length limits:

| Object type | Max name length |
|---|---|
| Table, view, alias | 128 characters (V12+), 18 characters (V11 and earlier) |
| Column | 30 characters (V12+), 30 characters (V11) |
| Index | 128 characters (V12+), 18 characters (V11 and earlier) |
| Constraint | 128 characters |
| Schema / collection | 128 characters |

> **Important:** The auto-generated index names from `_indexCommand()` use the pattern `tableName_col1_col2_type`. This can easily exceed 18 characters for V11 and earlier. Override `_indexCommand()` in your TableCompiler to truncate or hash long names.

```js
_indexCommand(type, tableName, columns) {
  const name = super._indexCommand(type, tableName, columns);
  // DB2 V11 and earlier: 18 char limit
  const maxLen = this.client.version && parseFloat(this.client.version) < 12 ? 18 : 128;
  const inner  = name.slice(1, -1); // strip quotes
  if (inner.length <= maxLen) return name;
  // truncate with a short hash suffix to avoid collisions
  const crypto = require('crypto');
  const hash   = crypto.createHash('md5').update(inner).digest('hex').slice(0, 4);
  return this.formatter.wrap(inner.slice(0, maxLen - 5) + '_' + hash);
}
```
