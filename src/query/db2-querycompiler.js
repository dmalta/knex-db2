const QueryCompiler = require('knex/lib/query/querycompiler');

class Db2QueryCompiler extends QueryCompiler {
  // Select with ROW_NUMBER() offset emulation for DB2 z/OS V11 baseline.
  // OFFSET ... FETCH NEXT was introduced in V12; V11 requires ROW_NUMBER().
  select() {
    const sql = super.select(); // base already handles CTEs via components array
    const limit = this.single.limit;
    const offset = this.single.offset;

    const hasLimit = limit != null;
    const hasOffset = offset != null;

    if (!hasOffset) return sql;

    const start = Number(offset) + 1;
    const end = hasLimit ? Number(offset) + Number(limit) : null;

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
    const noLimit = !this.single.limit && this.single.limit !== 0;
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
    return {
      sql: `TRUNCATE TABLE ${this.tableName} IMMEDIATE`,
    };
  }

  // Case-insensitive LIKE via UPPER() wrapping — DB2 is case-sensitive by default.
  whereILike(statement) {
    return `UPPER(${this._columnClause(statement)}) ${this._not(statement, 'LIKE ')}UPPER(${this._valueClause(statement)})`;
  }

  // Multi-row insert fast path for DB2 z/OS.
  // DB2 z/OS does not support multi-VALUES SQL (INSERT INTO t VALUES (...),(...)).
  // For multi-row data, emit a single-row template SQL plus a __db2BulkInsert
  // property carrying the column list and all row values. The client's query()
  // method detects __db2BulkInsert and uses ibm_db's column-wise ARRAY params
  // to execute all rows in a single round-trip.
  // Single-row inserts and raw SQL inserts fall through to super.insert() unchanged.
  insert() {
    const insertValues = this.single.insert || [];
    const insertData = this._prepInsert(insertValues);

    // Fall through for raw SQL inserts or single-row inserts
    if (
      typeof insertData === 'string' ||
      !insertData.columns ||
      !insertData.columns.length ||
      !insertData.values ||
      insertData.values.length <= 1
    ) {
      return super.insert();
    }

    const columns = insertData.columns;
    const placeholders = columns.map(() => '?').join(', ');
    const sql =
      this.with() + `insert into ${this.tableName} (${this.formatter.columnize(columns)}) values (${placeholders})`;

    return {
      sql,
      bindings: [],
      __db2BulkInsert: {
        columns,
        values: insertData.values,
      },
    };
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
    const column = this.single.columnInfo;
    const table = (this.single.table || '').toUpperCase();
    const schema = (
      this.single.schema ||
      this.client.connectionSettings?.currentSchema ||
      this.client.config.connection?.schema ||
      ''
    ).toUpperCase();
    const bindings = [table];

    let sql = 'SELECT NAME, COLTYPE, LENGTH, SCALE, NULLS, DEFAULT' + ' FROM SYSIBM.SYSCOLUMNS WHERE TBNAME = ?';

    if (schema) {
      sql += ' AND TBCREATOR = ?';
      bindings.push(schema);
    }

    return {
      sql,
      bindings,
      output(resp) {
        // Handle array response (raw format) or standard structure
        let rows = [];
        if (Array.isArray(resp)) {
          rows = resp;
        } else if (resp && Array.isArray(resp.rows)) {
          rows = resp.rows;
        }

        // Identify mapping strategy by looking at first row
        const out = rows.reduce((cols, row) => {
          // If the row acts like an array, we prefer numeric indices if we can't find NAME
          // In some z/OS environments row.NAME might be undefined but row[0] is correct
          // However, we MUST check for both '0' (string key) and 0 (numeric index)
          // to cover all driver result formats.
          const name = (row.NAME || row['NAME'] || row[0] || row['0'] || '').toString().trim();

          if (name && isNaN(name)) {
            cols[name.toUpperCase()] = {
              type: (row.COLTYPE || row['COLTYPE'] || row[1] || row['1'] || '').toString().trim(),
              maxLength: row.LENGTH ?? row['LENGTH'] ?? row[2] ?? row['2'],
              scale: row.SCALE ?? row['SCALE'] ?? row[3] ?? row['3'],
              nullable: (row.NULLS || row['NULLS'] || row[4] || row['4']) === 'Y',
              defaultValue: row.DEFAULT ?? row['DEFAULT'] ?? row[5] ?? row['5'],
            };
          }
          return cols;
        }, {});
        return (column && out[column.toUpperCase()]) || out;
      },
    };
  }
}

module.exports = { Db2QueryCompiler };
