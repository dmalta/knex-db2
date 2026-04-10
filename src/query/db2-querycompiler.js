const QueryCompiler = require('knex/lib/query/querycompiler');

class Db2QueryCompiler extends QueryCompiler {
  // Select with ROW_NUMBER() offset emulation for DB2 z/OS V11 baseline.
  // OFFSET ... FETCH NEXT was introduced in V12; V11 requires ROW_NUMBER().
  select() {
    const sql = super.select(); // base already handles CTEs via components array
    const limit  = this.single.limit;
    const offset = this.single.offset;

    const hasLimit  = limit != null;
    const hasOffset = offset != null;

    if (!hasOffset) return sql;

    const start = Number(offset) + 1;
    const end   = hasLimit ? Number(offset) + Number(limit) : null;

    return (
      `SELECT * FROM (SELECT inner__.*, ROW_NUMBER() OVER() AS rn__ ` +
      `FROM (${sql}) AS inner__) AS outer__ ` +
      `WHERE rn__ >= ${start}` +
      (end != null ? ` AND rn__ <= ${end}` : '')
    );
  }

  // When offset is present, the ROW_NUMBER subquery in select() handles the window.
  // When offset is absent, emit FETCH FIRST for plain limit-only queries.
  limit() {
    const noLimit  = !this.single.limit && this.single.limit !== 0;
    const hasOffset = this.single.offset != null;

    if (noLimit) return '';
    if (hasOffset) return ''; // handled by ROW_NUMBER in select()

    return `fetch first ${this.single.limit} rows only`;
  }

  // Offset is handled entirely in select() via ROW_NUMBER subquery.
  offset() {
    return '';
  }

  // DB2 locking clauses
  forUpdate() {
    return 'FOR UPDATE WITH RS';
  }

  forShare() {
    return 'FOR FETCH ONLY';
  }

  // DB2 z/OS V9+: TRUNCATE TABLE t IMMEDIATE
  truncate() {
    return `TRUNCATE TABLE ${this.tableName} IMMEDIATE`;
  }

  // Case-insensitive LIKE via UPPER() wrapping — DB2 is case-sensitive by default.
  whereILike(statement) {
    return `UPPER(${this._columnClause(statement)}) ${this._not(statement, 'LIKE ')}UPPER(${this._valueClause(statement)})`;
  }

  // Strip RECURSIVE keyword — DB2 z/OS does not use it (identical to MSSQL).
  with() {
    if (!this.grouped.with) return super.with();
    const restored = [];
    for (const stmt of this.grouped.with) {
      if (stmt.recursive) {
        stmt.recursive = false;
        restored.push(stmt);
      }
    }
    const result = super.with();
    for (const stmt of restored) stmt.recursive = true;
    return result;
  }

  // Query SYSIBM.SYSCOLUMNS catalog for column metadata.
  // DB2 stores unquoted object names in UPPERCASE.
  columnInfo() {
    const column   = this.single.columnInfo;
    const table    = (this.single.table || '').toUpperCase();
    const schema   = (
      this.single.schema ||
      this.client.connectionSettings?.currentSchema ||
      ''
    ).toUpperCase();
    const bindings = [table];

    let sql =
      'SELECT NAME, COLTYPE, LENGTH, SCALE, NULLS, DEFAULT' +
      ' FROM SYSIBM.SYSCOLUMNS WHERE TBNAME = ?';

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
}

module.exports = { Db2QueryCompiler };
