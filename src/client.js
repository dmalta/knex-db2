const Client = require('knex/lib/client');
let db2;
try {
  db2 = require('ibm_db');
} catch (err) {
  // Mock ibm_db for testing when native bindings aren't available
  db2 = {
    open: (connStr, callback) => {
      callback(new Error('ibm_db native bindings not available - using mock'));
    }
  };
}
const { Db2QueryCompiler: QueryCompilerImpl } = require('./query/querycompiler');
const { Db2SchemaCompiler: SchemaCompilerImpl } = require('./schema/compiler');
const { Db2TableCompiler: TableCompilerImpl } = require('./schema/tablecompiler');
const { Db2ColumnCompiler: ColumnCompilerImpl } = require('./schema/columncompiler');

class Db2ClientImpl extends Client {
  constructor(config = {}) {
    super(config);
    
    // Set dialect-specific properties
    this.driverName = 'db2';
  }

  _driver() {
    return db2;
  }

  queryCompiler(builder, formatter) {
    return new QueryCompilerImpl(this, builder, formatter);
  }

  schemaCompiler() {
    return new SchemaCompilerImpl(this, ...arguments);
  }

  tableCompiler() {
    return new TableCompilerImpl(this, ...arguments);
  }

  columnCompiler() {
    return new ColumnCompilerImpl(this, ...arguments);
  }

  wrapIdentifierImpl(value) {
    if (value === '*') return value;
    // DB2 uses double quotes for identifiers
    return `"${value.replace(/"/g, '""')}"`;
  }

  // Get a raw connection for DB2
  acquireRawConnection() {
    const connectionSettings = this.connectionSettings;
    
    return new Promise((resolve, reject) => {
      // Build DB2 connection string
      const connStr = `DATABASE=${connectionSettings.database};HOSTNAME=${connectionSettings.hostname};PORT=${connectionSettings.port};PROTOCOL=TCPIP;UID=${connectionSettings.uid};PWD=${connectionSettings.pwd};`;
      
      db2.open(connStr, (err, connection) => {
        if (err) {
          return reject(err);
        }
        
        // Set connection properties
        connection.__knex__disposed = false;
        
        resolve(connection);
      });
    });
  }

  // Close DB2 connection
  async destroyRawConnection(connection) {
    return new Promise((resolve, reject) => {
      if (connection.__knex__disposed) {
        return resolve();
      }
      
      connection.close((err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }

  validateConnection(connection) {
    return connection && !connection.__knex__disposed;
  }

  // DB2 uses parameter markers (?) for prepared statements
  positionBindings(sql) {
    return sql;
  }

  // Execute query using DB2
  _query(connection, obj) {
    if (!obj.sql) throw new Error('The query is empty');

    return new Promise((resolve, reject) => {
      connection.query(obj.sql, obj.bindings || [], (err, result, moreResultSets) => {
        if (err) {
          reject(err);
        } else {
          const response = {
            response: result || [],
            moreResultSets: moreResultSets
          };
          resolve(response);
        }
      });
    });
  }

  // Process query response
  processResponse(obj, runner) {
    if (obj == null) return;
    
    const { response } = obj;
    if (obj.output) return obj.output.call(runner, response);
    if (obj.method === 'raw') return response;
    if (Array.isArray(response)) {
      return response;
    }
    return response;
  }
}

module.exports = Db2ClientImpl;
