const ColumnCompiler = require('knex/lib/schema/columncompiler');
const { toNumber } = require('knex/lib/util/helpers');

class Db2ColumnCompiler extends ColumnCompiler {
  constructor(client, tableCompiler, columnBuilder) {
    super(client, tableCompiler, columnBuilder);
    this.modifiers = ['nullable', 'defaultTo', 'comment'];
    this._addCheckModifiers();
  }

  increments(options = { primaryKey: true }) {
    return (
      'integer not null generated always as identity (start with 1, increment by 1)' +
      (this.tableCompiler._canBeAddPrimaryKey(options) ? ' primary key' : '')
    );
  }

  bigincrements(options = { primaryKey: true }) {
    return (
      'bigint not null generated always as identity (start with 1, increment by 1)' +
      (this.tableCompiler._canBeAddPrimaryKey(options) ? ' primary key' : '')
    );
  }

  varchar(length) {
    return `varchar(${toNumber(length, 255)})`;
  }

  decimal(precision, scale) {
    if (precision == null) return 'decimal';
    return `decimal(${toNumber(precision, 8)}, ${toNumber(scale, 2)})`;
  }

  floating(precision) {
    return `float(${toNumber(precision, 8)})`;
  }

  double() {
    return 'double';
  }

  timestamp({ useTz = false } = {}) {
    if (useTz) {
      throw new Error('timestamp({ useTz: true }) is not supported for db2-zos');
    }
    return 'timestamp';
  }

  datetime(options) {
    return this.timestamp(options);
  }

  bool() {
    this.modified.checkIn = [[0, 1]];
    return 'smallint';
  }

  enu(allowed = []) {
    const values = allowed.length ? allowed : [''];
    const maxLength = values.reduce((max, value) => Math.max(max, String(value).length), 1);
    this.modified.checkIn = [values];
    return `varchar(${maxLength})`;
  }

  uuid({ useBinaryUuid = false } = {}) {
    return useBinaryUuid ? 'binary(16)' : 'char(36)';
  }

  comment(comment) {
    if (!comment) return '';

    const tableName = this.tableCompiler.tableName();
    const columnName = this.formatter.wrap(this.getColumnName());
    const escaped = String(comment).replace(/'/g, "''");

    this.pushAdditional(function () {
      this.pushQuery(`COMMENT ON COLUMN ${tableName}.${columnName} IS '${escaped}'`);
    });

    return '';
  }
}

Db2ColumnCompiler.prototype.integer = 'integer';
Db2ColumnCompiler.prototype.tinyint = 'smallint';
Db2ColumnCompiler.prototype.smallint = 'smallint';
Db2ColumnCompiler.prototype.mediumint = 'integer';
Db2ColumnCompiler.prototype.biginteger = 'bigint';
Db2ColumnCompiler.prototype.text = 'clob(32000)';
Db2ColumnCompiler.prototype.mediumtext = 'clob(16m)';
Db2ColumnCompiler.prototype.longtext = 'clob(2g)';
Db2ColumnCompiler.prototype.json = 'clob(2m)';
Db2ColumnCompiler.prototype.jsonb = 'clob(2m)';
Db2ColumnCompiler.prototype.date = 'date';
Db2ColumnCompiler.prototype.time = 'time';
Db2ColumnCompiler.prototype.binary = 'blob';
Db2ColumnCompiler.prototype.bit = 'char(1) for bit data';

module.exports = { Db2ColumnCompiler };
