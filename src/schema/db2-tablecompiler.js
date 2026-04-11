'use strict';
const TableCompiler = require('knex/lib/schema/tablecompiler');

class Db2TableCompiler extends TableCompiler {
  constructor(client, tableBuilder) {
    super(client, tableBuilder);
  }

  createQuery(columns, ifNot, like) {
    const seqStart = this.sequence.length;
    if (like) {
      // DB2 z/OS: CREATE TABLE new AS (SELECT * FROM old) WITH NO DATA
      const sql = `CREATE TABLE ${this.tableName()} AS (SELECT * FROM ${this.tableNameLike()}) WITH NO DATA`;
      this.pushQuery(sql);
      if (columns.sql && columns.sql.length > 0) {
        this.addColumns(columns, this.addColumnsPrefix);
      }
    } else {
      // Collect any t.col().primary() entries, remove them from grouped.alterTable
      // (so the base-class loop doesn't also try to emit them), then delegate to
      // this.primary() which emits the correct two-statement DB2 sequence.
      const pkEntries = (this.grouped.alterTable || []).filter((s) => s.method === 'primary');
      if (pkEntries.length > 0) {
        const pkCols = pkEntries.flatMap((e) => (Array.isArray(e.args[0]) ? e.args[0] : [e.args[0]]));
        const constraintName = pkEntries[0].args[1] || undefined;
        this.grouped.alterTable = this.grouped.alterTable.filter((s) => s.method !== 'primary');
        // Push CREATE TABLE first, then delegate PK statements to primary().
        const checks = this._addChecks ? this._addChecks() : '';
        const tablespace = this.single.tablespace ? ` IN ${this.single.tablespace}` : '';
        this.pushQuery(`CREATE TABLE ${this.tableName()} (` + columns.sql.join(', ') + checks + `)${tablespace}`);
        this.primary(pkCols, constraintName);
      } else {
        const checks = this._addChecks ? this._addChecks() : '';
        const tablespace = this.single.tablespace ? ` IN ${this.single.tablespace}` : '';
        this.pushQuery(`CREATE TABLE ${this.tableName()} (` + columns.sql.join(', ') + checks + `)${tablespace}`);
      }
    }
    if (this.single.comment) this.comment(this.single.comment);

    // createTableIfNotExists: tag every pushed query so that _executeDDL
    // silently swallows -601 (object already exists) and -607 (constraint
    // name already in use) — no IF NOT EXISTS syntax needed in the SQL.
    if (ifNot) {
      for (let i = seqStart; i < this.sequence.length; i++) {
        this.sequence[i].suppressIfExists = true;
      }
    }
  }

  comment(comment) {
    this.pushQuery(`COMMENT ON TABLE ${this.tableName()} IS '${(comment || '').replace(/'/g, "''")}'`);
  }

  addColumns(columns, prefix) {
    if (!columns.sql || columns.sql.length === 0) return;
    prefix = prefix || this.addColumnsPrefix;
    columns.sql.forEach((col) => {
      this.pushQuery({
        sql: `ALTER TABLE ${this.tableName()} ${prefix}${col}`,
        bindings: columns.bindings,
      });
    });
  }

  alterColumns(columns, colBuilders) {
    if (!colBuilders || colBuilders.length === 0) return;
    // DB2 z/OS does not support full column redefinition in ALTER TABLE.
    // Generate individual SET/DROP clauses from the modifier flags.
    colBuilders.forEach((cc) => {
      const colName = this.formatter.wrap(cc.args[0]);
      const mods = (cc.columnBuilder && cc.columnBuilder._modifiers) || {};

      // Nullability change: nullable key is present in _modifiers
      if ('nullable' in mods) {
        const isNotNull = Array.isArray(mods.nullable) && mods.nullable.length > 0 && mods.nullable[0] === false;
        this.pushQuery({
          sql:
            `ALTER TABLE ${this.tableName()} ALTER COLUMN ${colName} ` + (isNotNull ? 'SET NOT NULL' : 'DROP NOT NULL'),
          bindings: [],
        });
      }

      // Default value change: defaultTo key is present in _modifiers
      if ('defaultTo' in mods) {
        const def = Array.isArray(mods.defaultTo) ? mods.defaultTo[0] : mods.defaultTo;
        if (def === null || def === undefined) {
          this.pushQuery({
            sql: `ALTER TABLE ${this.tableName()} ALTER COLUMN ${colName} DROP DEFAULT`,
            bindings: [],
          });
        } else {
          const quoted = typeof def === 'string' ? `'${def.replace(/'/g, "''")}'` : def;
          this.pushQuery({
            sql: `ALTER TABLE ${this.tableName()} ALTER COLUMN ${colName} SET DEFAULT ${quoted}`,
            bindings: [],
          });
        }
      }
    });
  }

  dropColumn() {
    const columns = Array.from(arguments).flat();
    columns.forEach((column) => {
      // DB2 z/OS requires RESTRICT (default) or CASCADE after DROP COLUMN.
      this.pushQuery(`ALTER TABLE ${this.tableName()} ${this.dropColumnPrefix}${this.formatter.wrap(column)} RESTRICT`);
    });
  }

  renameColumn(from, to) {
    // V11+ syntax
    this.pushQuery(
      `ALTER TABLE ${this.tableName()} RENAME COLUMN ${this.formatter.wrap(from)} TO ${this.formatter.wrap(to)}`
    );
  }

  primary(columns, constraintName) {
    const cols = this.formatter.columnize(columns);
    const name = constraintName
      ? this.formatter.wrap(constraintName)
      : this.formatter.wrap(`${this.tableNameRaw}_pkey`);
    // DB2 requires a unique index to back any primary key constraint.
    // Emit both statements regardless of whether this is a CREATE TABLE
    // or an ALTER TABLE context — they are always separate DDL steps on DB2.
    this.pushQuery(`CREATE UNIQUE INDEX ${name} ON ${this.tableName()} (${cols})`);
    this.pushQuery(`ALTER TABLE ${this.tableName()} ADD CONSTRAINT ${name} PRIMARY KEY (${cols})`);
  }

  unique(columns, indexName) {
    const name = indexName ? this.formatter.wrap(indexName) : this._indexCommand('unique', this.tableNameRaw, columns);
    const cols = this.formatter.columnize(columns);
    if (this.forCreate) {
      this.pushQuery(`CONSTRAINT ${name} UNIQUE (${cols})`);
    } else {
      this.pushQuery(`CREATE UNIQUE INDEX ${name} ON ${this.tableName()} (${cols})`);
    }
  }

  index(columns, indexName, _options) {
    const name = indexName ? this.formatter.wrap(indexName) : this._indexCommand('index', this.tableNameRaw, columns);
    const cols = this.formatter.columnize(columns);
    this.pushQuery(`CREATE INDEX ${name} ON ${this.tableName()} (${cols})`);
  }

  dropIndex(columns, indexName) {
    // DB2: DROP INDEX name — no ON table clause
    const name = indexName ? this.formatter.wrap(indexName) : this._indexCommand('index', this.tableNameRaw, columns);
    this.pushQuery(`DROP INDEX ${name}`);
  }

  dropUnique(columns, indexName) {
    const name = indexName ? this.formatter.wrap(indexName) : this._indexCommand('unique', this.tableNameRaw, columns);
    this.pushQuery(`DROP INDEX ${name}`);
  }

  dropForeign(columns, indexName) {
    const name = indexName ? this.formatter.wrap(indexName) : this._indexCommand('foreign', this.tableNameRaw, columns);
    this.pushQuery(`ALTER TABLE ${this.tableName()} DROP FOREIGN KEY ${name}`);
  }

  dropPrimary(_constraintName) {
    // DB2 allows only one PK per table — DROP PRIMARY KEY requires no name
    this.pushQuery(`ALTER TABLE ${this.tableName()} DROP PRIMARY KEY`);
  }

  _setNullableState(column, isNullable) {
    const col = this.formatter.columnize(column);
    const action = isNullable ? 'DROP NOT NULL' : 'SET NOT NULL';
    this.pushQuery(`ALTER TABLE ${this.tableName()} ALTER COLUMN ${col} ${action}`);
  }
}

// Prototype configuration — uppercase for DB2 DDL readability
Db2TableCompiler.prototype.lowerCase = false;
Db2TableCompiler.prototype.addColumnsPrefix = 'ADD COLUMN ';
Db2TableCompiler.prototype.alterColumnsPrefix = 'ALTER COLUMN ';
Db2TableCompiler.prototype.dropColumnPrefix = 'DROP COLUMN ';
// Process unique constraints inline inside CREATE TABLE so that
// DB2 z/OS does not need a separate CREATE UNIQUE INDEX statement.
// Primary key columns are handled in createQuery() by emitting a
// CREATE UNIQUE INDEX followed by ALTER TABLE ADD CONSTRAINT PRIMARY KEY
// after the CREATE TABLE — the two-statement sequence required by DB2.
Db2TableCompiler.prototype.createAlterTableMethods = ['unique'];

module.exports = { Db2TableCompiler };
