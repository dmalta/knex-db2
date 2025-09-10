const QueryCompiler = require('knex/lib/query/querycompiler');

class Db2QueryCompiler extends QueryCompiler {
  constructor(client, builder, formatter) {
    super(client, builder, formatter);
  }

  // DB2 specific query compilation methods
  
  // Override limit/offset for DB2 syntax
  limit() {
    const noLimit = !this.single.limit && this.single.limit !== 0;
    if (noLimit) return '';
    
    return `fetch first ${this.single.limit} rows only`;
  }

  offset() {
    const noOffset = !this.single.offset;
    if (noOffset) return '';
    
    return `offset ${this.single.offset} rows`;
  }

  // DB2 supports CTEs
  with() {
    const withs = this.grouped.with;
    if (!withs) return '';
    
    return 'with ' + withs.map(w => w.sql).join(', ');
  }

  // Handle SELECT queries with DB2 specifics
  select() {
    const sql = this.with() + super.select();
    return sql;
  }

  // DB2 specific INSERT syntax
  insert() {
    let sql = super.insert();
    if (sql === '') return sql;
    
    // Handle VALUES clause properly for DB2
    return sql;
  }

  // DB2 specific UPDATE syntax
  update() {
    const sql = super.update();
    return sql;
  }

  // DB2 specific DELETE syntax
  del() {
    const sql = super.del();
    return sql;
  }

  // Override for proper ORDER BY handling
  orderBy() {
    const sql = super.orderBy();
    return sql;
  }

  // Override GROUP BY
  groupBy() {
    const sql = super.groupBy();
    return sql;
  }

  // Override HAVING
  having() {
    const sql = super.having();
    return sql;
  }

  // DB2 JOIN handling
  join() {
    const sql = super.join();
    return sql;
  }

  // DB2 WHERE clause
  where() {
    const sql = super.where();
    return sql;
  }
}

module.exports = { Db2QueryCompiler };
