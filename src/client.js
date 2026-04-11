const Client = require('knex/lib/client');
let db2;
try {
  db2 = require('ibm_db');
} catch {
  // Mock ibm_db for testing when native bindings aren't available
  db2 = {
    open: (connStr, callback) => {
      callback(new Error('ibm_db native bindings not available - using mock'));
    },
  };
}
const { Db2QueryCompiler } = require('./query/db2-querycompiler');
const { Db2ColumnCompiler } = require('./schema/db2-columncompiler');
const { handleDB2Error, DB2_ERROR_MAP } = require('./db2-errors');
const { Db2SchemaCompiler } = require('./schema/db2-schemacompiler');
const { Db2TableCompiler }  = require('./schema/db2-tablecompiler');
const { Db2Transaction }    = require('./transaction');

class Db2Client extends Client {
  constructor(config = {}) {
    // Ensure client is set to avoid deprecation warning
    if (!config.client) {
      config.client = 'db2';
    }
    super(config);
  }

  _driver() {
    return db2;
  }

  queryCompiler(builder, formatter) {
    return new Db2QueryCompiler(this, builder, formatter);
  }

  schemaCompiler() {
    return new Db2SchemaCompiler(this, ...arguments);
  }

  tableCompiler() {
    return new Db2TableCompiler(this, ...arguments);
  }

  columnCompiler() {
    return new Db2ColumnCompiler(this, ...arguments);
  }

  transaction() {
    return new Db2Transaction(this, ...arguments);
  }

  wrapIdentifierImpl(value) {
    return value;
  }

  // DB2 Error Code Mapping - delegated to db2-errors module
  getErrorMap() {
    return DB2_ERROR_MAP;
  }

  // Enhanced error handling - delegated to db2-errors module
  handleError(error, sql = null, bindings = null) {
    return handleDB2Error(error, sql, bindings);
  }

  // Get a raw connection for DB2 with enhanced error handling
  acquireRawConnection() {
    // Use this.config.connection directly to ensure we get all fields including password
    const connectionSettings = this.config.connection;

    return new Promise((resolve, reject) => {
      try {
        // Build DB2 connection string with additional options
        const connStr = this.buildConnectionString(connectionSettings);

        const connectionTimeout = connectionSettings.connectionTimeout || 10000;
        let timeoutHandle;

        // Set connection timeout
        if (connectionTimeout > 0) {
          timeoutHandle = setTimeout(() => {
            reject(new Error('Connection timeout after ' + connectionTimeout + 'ms'));
          }, connectionTimeout);
        }

        db2.open(connStr, (err, connection) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);

          if (err) {
            const enhancedError = this.handleError(err);
            return reject(enhancedError);
          }

          // Set connection properties for pooling
          connection.__knex__disposed = false;
          connection.__knex__acquired = new Date();
          connection.__knex__db2_client = this;

          // Set connection-level options
          this.setConnectionOptions(connection);

          resolve(connection);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // Build DB2 connection string with all options
  buildConnectionString(settings) {
    const options = [
      'DRIVER=IBM DB2 ODBC DRIVER',
      `DATABASE=${settings.database}`,
      `HOSTNAME=${settings.hostname}`,
      `PORT=${settings.port || 50000}`,
      'PROTOCOL=TCPIP',
      `UID=${settings.user || settings.uid}`,
      `PWD=${settings.password || settings.pwd}`,
    ];

    // Add optional connection parameters
    if (settings.schema) options.push(`CURRENTSCHEMA=${settings.schema}`);
    if (settings.connectTimeout) options.push(`CONNECTTIMEOUT=${settings.connectTimeout}`);
    if (settings.queryTimeout) options.push(`QUERYTIMEOUT=${settings.queryTimeout}`);
    if (settings.security === 'SSL') options.push('SECURITY=SSL');

    return options.join(';') + ';';
  }

  // Set DB2-specific connection options
  setConnectionOptions(connection) {
    // Set autocommit mode (default: true for Knex compatibility)
    const autocommit = this.config.connection?.autocommit !== false;

    // Note: ibm_db handles autocommit differently, this is a placeholder
    // for when we need to set specific DB2 connection attributes
    connection.__knex__autocommit = autocommit;
  }

  // Enhanced connection closing with proper cleanup
  async destroyRawConnection(connection) {
    return new Promise((resolve, reject) => {
      if (connection.__knex__disposed) {
        return resolve();
      }

      // Mark as disposed immediately to prevent reuse
      connection.__knex__disposed = true;

      // Close with timeout
      const closeTimeout = setTimeout(() => {
        reject(new Error('Connection close timeout'));
      }, 5000);

      connection.close((err) => {
        clearTimeout(closeTimeout);
        if (err) {
          const enhancedError = this.handleError(err);
          return reject(enhancedError);
        }
        resolve();
      });
    });
  }

  validateConnection(connection) {
    if (!connection || connection.__knex__disposed) {
      return Promise.resolve(false);
    }

    // Check if connection has required DB2 methods
    if (typeof connection.query !== 'function' || typeof connection.close !== 'function') {
      return Promise.resolve(false);
    }

    // Execute SYSDUMMY1 query to validate connection is working
    return new Promise((resolve) => {
      connection.query('SELECT * FROM SYSIBM.SYSDUMMY1', [], (err, result) => {
        if (err) {
          resolve(false);
        } else {
          // Validate we got a result array with at least one row
          resolve(result && Array.isArray(result) && result.length > 0);
        }
      });
    });
  }

  // Execute query using DB2 with enhanced error handling
  query(connection, obj) {
    if (!obj.sql) throw new Error('The query is empty');

    return new Promise((resolve, reject) => {
      const queryTimeout = this.config.connection?.queryTimeout || 30000;
      let timeoutHandle;

      // Set query timeout
      if (queryTimeout > 0) {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Query timeout after ${queryTimeout}ms: ${obj.sql.substring(0, 100)}...`));
        }, queryTimeout);
      }

      connection.query(obj.sql, obj.bindings || [], (err, result, moreResultSets) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (err) {
          const enhancedError = this.handleError(err, obj.sql, obj.bindings);
          reject(enhancedError);
        } else {
          const response = {
            response: result || [],
            moreResultSets: moreResultSets,
            rowCount: Array.isArray(result) ? result.length : 0,
          };
          resolve(response);
        }
      });
    });
  }

  // Process the response as returned from the query
  processResponse(obj, runner) {
    if (obj == null) return;
    let { response } = obj;
    const { method } = obj;

    if (obj.output) {
      return obj.output.call(runner, response);
    }

    // DB2 result processing - results are already in the correct format
    // from ibm_db driver (array of objects)
    switch (method) {
      case 'select':
        return response;
      case 'first':
        return response[0];
      case 'pluck':
        return response.map((row) => row[obj.pluck]);
      case 'insert':
      case 'del':
      case 'update':
      case 'counter':
        if (obj.returning) {
          return response;
        }
        return obj.rowCount || 0;
      default:
        return response;
    }
  }
}

// Set static properties on the client prototype
Object.assign(Db2Client.prototype, {
  dialect: 'db2',
  driverName: 'db2',
});

module.exports = Db2Client;
