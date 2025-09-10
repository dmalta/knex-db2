const QueryCompiler = require('knex/lib/query/querycompiler');

class Db2QueryCompiler extends QueryCompiler {
  constructor(client, builder, formatter) {
    super(client, builder, formatter);
  }

  // DB2 specific query compilation methods will go here
  
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

  // DB2 supports CTEs differently
  with() {
    const withs = this.grouped.with;
    if (!withs) return '';
    
    return 'with ' + withs.map(w => w.sql).join(', ');
  }
}

module.exports = { Db2QueryCompiler };
