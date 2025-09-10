const TableCompiler = require('knex/lib/schema/tablecompiler');

class Db2TableCompiler extends TableCompiler {
  // Inherits all default behavior from base TableCompiler
  // Add DB2-specific table methods only when needed
}

module.exports = { Db2TableCompiler };
