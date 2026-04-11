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

  hasSchema(schemaName) {
    const schema = schemaName.toUpperCase();
    const sql = `SELECT 1 FROM SYSIBM.SYSSCHEMATA WHERE SCHEMANAME = ?`;
    const bindings = [schema];
    this.pushQuery({ sql, bindings, output: (resp) => resp.length > 0 });
  }

  renameTable(from, to) {
    const schemaPrefix = this.schema ? `${this.schema}.` : '';
    this.pushQuery(`RENAME TABLE ${schemaPrefix}${from} TO ${to}`);
  }

  dropTableIfExists(_tableName) {
    throw new Error(
      'DROP TABLE IF EXISTS is not supported — use dropTable() and handle SQL0204N (object not found) in your application'
    );
  }

  createSchema(schemaName) {
    this.pushQuery(`CREATE SCHEMA ${schemaName}`);
  }

  createSchemaIfNotExists(_schemaName) {
    throw new Error(
      'CREATE SCHEMA IF NOT EXISTS is not supported — use createSchema() and handle errors in your application'
    );
  }

  dropSchema(schemaName, cascade) {
    const qualifier = cascade ? 'CASCADE' : 'RESTRICT';
    this.pushQuery(`DROP SCHEMA ${schemaName} ${qualifier}`);
  }

  dropSchemaIfExists(_schemaName, _cascade) {
    throw new Error('DROP SCHEMA IF EXISTS is not supported — use dropSchema() and handle errors in your application');
  }
}

module.exports = { Db2SchemaCompiler };
