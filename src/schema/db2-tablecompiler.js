'use strict';
const TableCompiler = require('knex/lib/schema/tablecompiler');

class Db2TableCompiler extends TableCompiler {
  constructor(client, tableBuilder) {
    super(client, tableBuilder);
  }

  createQuery(columns, ifNot, like) {
    if (like) {
      // DB2 z/OS: CREATE TABLE new AS (SELECT * FROM old) WITH NO DATA
      const sql = `CREATE TABLE ${this.tableName()} AS (SELECT * FROM ${this.tableNameLike()}) WITH NO DATA`;
      this.pushQuery(sql);
      if (columns.sql && columns.sql.length > 0) {
        this.addColumns(columns, this.addColumnsPrefix);
      }
    } else {
      const checks = this._addChecks ? this._addChecks() : '';
      const tablespace = this.single.tablespace
        ? ` IN ${this.single.tablespace}`
        : '';
      const sql =
        `CREATE TABLE ${this.tableName()} (` +
        columns.sql.join(', ') +
        checks +
        `)${tablespace}`;
      this.pushQuery(sql);
    }
    if (this.single.comment) this.comment(this.single.comment);
  }

  comment(comment) {
    this.pushQuery(
      `COMMENT ON TABLE ${this.tableName()} IS '${(comment || '').replace(/'/g, "''")}'`
    );
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
    if (!columns.sql || columns.sql.length === 0) return;
    columns.sql.forEach((sql) => {
      this.pushQuery({
        sql: `ALTER TABLE ${this.tableName()} ${this.alterColumnsPrefix}${sql}`,
        bindings: columns.bindings,
      });
    });
  }

  dropColumn() {
    const columns = Array.from(arguments).flat();
    columns.forEach((column) => {
      this.pushQuery(
        `ALTER TABLE ${this.tableName()} ${this.dropColumnPrefix}${this.formatter.wrap(column)}`
      );
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
    if (this.forCreate) {
      this.pushQuery(`CONSTRAINT ${name} PRIMARY KEY (${cols})`);
    } else {
      this.pushQuery(
        `ALTER TABLE ${this.tableName()} ADD CONSTRAINT ${name} PRIMARY KEY (${cols})`
      );
    }
  }

  unique(columns, indexName) {
    const name = indexName
      ? this.formatter.wrap(indexName)
      : this._indexCommand('unique', this.tableNameRaw, columns);
    const cols = this.formatter.columnize(columns);
    if (this.forCreate) {
      this.pushQuery(`CONSTRAINT ${name} UNIQUE (${cols})`);
    } else {
      this.pushQuery(
        `CREATE UNIQUE INDEX ${name} ON ${this.tableName()} (${cols})`
      );
    }
  }

  index(columns, indexName, options) {
    const name = indexName
      ? this.formatter.wrap(indexName)
      : this._indexCommand('index', this.tableNameRaw, columns);
    const cols = this.formatter.columnize(columns);
    this.pushQuery(`CREATE INDEX ${name} ON ${this.tableName()} (${cols})`);
  }

  dropIndex(columns, indexName) {
    // DB2: DROP INDEX name — no ON table clause
    const name = indexName
      ? this.formatter.wrap(indexName)
      : this._indexCommand('index', this.tableNameRaw, columns);
    this.pushQuery(`DROP INDEX ${name}`);
  }

  dropUnique(columns, indexName) {
    const name = indexName
      ? this.formatter.wrap(indexName)
      : this._indexCommand('unique', this.tableNameRaw, columns);
    this.pushQuery(`DROP INDEX ${name}`);
  }

  dropForeign(columns, indexName) {
    const name = indexName
      ? this.formatter.wrap(indexName)
      : this._indexCommand('foreign', this.tableNameRaw, columns);
    this.pushQuery(
      `ALTER TABLE ${this.tableName()} DROP FOREIGN KEY ${name}`
    );
  }

  dropPrimary(constraintName) {
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

module.exports = { Db2TableCompiler };
