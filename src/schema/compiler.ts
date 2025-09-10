const SchemaCompiler = require('knex/lib/schema/compiler');

class Db2SchemaCompiler extends SchemaCompiler {
  constructor(client, builder) {
    super(client, builder);
  }

  // DB2 specific schema compilation methods
}

module.exports = { Db2SchemaCompiler };
