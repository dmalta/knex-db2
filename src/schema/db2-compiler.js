const SchemaCompiler = require('knex/lib/schema/compiler');

class Db2SchemaCompiler extends SchemaCompiler {
  // Inherits all default behavior from base SchemaCompiler
  // Add DB2-specific schema methods only when needed
}

module.exports = { Db2SchemaCompiler };
