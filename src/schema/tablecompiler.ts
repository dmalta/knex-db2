const TableCompiler = require('knex/lib/schema/tablecompiler');

class Db2TableCompiler extends TableCompiler {
  constructor(client, tableBuilder) {
    super(client, tableBuilder);
  }

  // DB2 specific table compilation methods will go here
}

module.exports = { Db2TableCompiler };
