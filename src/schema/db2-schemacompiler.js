'use strict';
const SchemaCompiler = require('knex/lib/schema/compiler');

class Db2SchemaCompiler extends SchemaCompiler {
  constructor(client, builder) {
    super(client, builder);
  }

  hasTable(tableName) {
    const table = tableName.toUpperCase();
    const schema = (this.schema || this.client.connectionSettings?.currentSchema || '').toUpperCase();
    const bindings = [table];
    let sql = `SELECT 1 FROM SYSIBM.SYSTABLES WHERE NAME = ? AND TYPE = 'T'`;
    if (schema) {
      sql += ' AND CREATOR = ?';
      bindings.push(schema);
    }
    this.pushQuery({ sql, bindings, output: (resp) => resp.length > 0 });
  }

  hasColumn(tableName, columnName) {
    const table = tableName.toUpperCase();
    const column = columnName.toUpperCase();
    const schema = (this.schema || this.client.connectionSettings?.currentSchema || '').toUpperCase();
    const bindings = [table, column];
    let sql = `SELECT 1 FROM SYSIBM.SYSCOLUMNS WHERE TBNAME = ? AND NAME = ?`;
    if (schema) {
      sql += ' AND TBCREATOR = ?';
      bindings.push(schema);
    }
    this.pushQuery({ sql, bindings, output: (resp) => resp.length > 0 });
  }

  renameTable(from, to) {
    const schemaPrefix = this.schema ? `${this.schema}.` : '';
    this.pushQuery(`RENAME TABLE ${schemaPrefix}${from} TO ${to}`);
  }

  dropTableIfExists(tableName) {
    // DB2 z/OS has no DROP TABLE IF EXISTS syntax.
    // Emit unconditional DROP TABLE; migration author guards with hasTable().
    const schemaPrefix = this.schema ? `${this.schema}.` : '';
    this.pushQuery(`DROP TABLE ${schemaPrefix}${tableName}`);
  }

  createSchema(schemaName) {
    this.pushQuery(`CREATE SCHEMA ${schemaName}`);
  }

  createSchemaIfNotExists(schemaName) {
    // DB2 has no CREATE SCHEMA IF NOT EXISTS.
    // Per planning doc: use stepwise migration — check first, then create.
    throw new Error(
      'db2-zos: createSchemaIfNotExists() is not supported. ' +
        'Use knex.schema.hasSchema(name) in your migration, then call createSchema() conditionally.'
    );
  }

  dropSchema(schemaName, cascade) {
    const qualifier = cascade ? 'CASCADE' : 'RESTRICT';
    this.pushQuery(`DROP SCHEMA ${schemaName} ${qualifier}`);
  }

  dropSchemaIfExists(schemaName, cascade) {
    // DB2 has no DROP SCHEMA IF EXISTS syntax.
    // Emit unconditional DROP SCHEMA; migration author guards with hasSchema().
    const qualifier = cascade ? 'CASCADE' : 'RESTRICT';
    this.pushQuery(`DROP SCHEMA ${schemaName} ${qualifier}`);
  }
}

module.exports = { Db2SchemaCompiler };
