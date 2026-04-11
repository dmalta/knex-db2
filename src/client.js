const Client = require('knex/lib/client');
const TableBuilder = require('knex/lib/schema/tablebuilder');
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
const { Db2TableCompiler } = require('./schema/db2-tablecompiler');
const { Db2Transaction } = require('./transaction');

// Add DB2-specific tablespace() method to the table builder callback API.
// Usage: db.schema.createTable(name, (t) => { t.tablespace('SCHEMA.TSNAME'); ... })
TableBuilder.extend('tablespace', function (tablespaceName) {
  this._single.tablespace = tablespaceName;
  return this;
});

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

  // Execute a multi-row INSERT using ibm_db's column-wise ARRAY parameter mechanism.
  // Transposes row-major values[][] to column-major ARRAY params and calls
  // connection.query() in a single round-trip — no prepare/executeNonQuery needed.
  _executeBulkInsert(connection, obj) {
    const { columns, values } = obj.__db2BulkInsert;
    const numRows = values.length;

    // Transpose row-major values[][] → column-major ARRAY params.
    // DataType: 1 (SQL_CHAR) is used for all columns — ibm_db coerces automatically.
    const params = columns.map((_, colIdx) => ({
      ParamType: 'ARRAY',
      DataType: 1,
      Data: values.map((row) => row[colIdx]),
    }));

    return new Promise((resolve, reject) => {
      connection.query({ sql: obj.sql, params, ArraySize: numRows }, (err) => {
        if (err) return reject(this.handleError(err, obj.sql));
        obj.response = [];
        obj.rowCount = numRows;
        resolve(obj);
      });
    });
  }

  // Execute a DML statement (INSERT/UPDATE/DELETE/MERGE) — no result set expected.
  // Handles positive SQLCODE warnings by invalidating the connection.
  async _executeDML(connection, stmt, obj) {
    try {
      const affectedRows = await stmt.executeNonQuery(obj.bindings || []);
      obj.response = [];
      obj.rowCount = typeof affectedRows === 'number' ? affectedRows : 0;
      return obj;
    } catch (execErr) {
      // Positive SQLCODE = DB2 warning (e.g. +513 whole-table DELETE) — operation succeeded.
      // Invalidate the connection so the pool creates a fresh one: ibm_db leaves the ODBC
      // handle in a "warning pending" state that can corrupt subsequent queries.
      const sqlCode = execErr.sqlcode || execErr.code;
      if (typeof sqlCode === 'number' && sqlCode > 0) {
        connection.__knex__disposed = true;
        obj.response = [];
        obj.rowCount = 0;
        return obj;
      }
      throw this.handleError(execErr, obj.sql, obj.bindings);
    } finally {
      try {
        stmt.closeSync();
      } catch {}
    }
  }

  // Execute a DDL statement (CREATE/DROP/ALTER/TRUNCATE/…) — no result set or row count.
  async _executeDDL(stmt, obj) {
    try {
      await stmt.executeNonQuery(obj.bindings || []);
      obj.response = [];
      obj.rowCount = 0;
      return obj;
    } catch (execErr) {
      // suppressIfNotFound: silently succeed when the object does not exist
      // (e.g. dropTableIfExists on a table that was already dropped — SQL0204N).
      if (obj.suppressIfNotFound) {
        const code = execErr.sqlcode || execErr.code;
        if (code === -204 || code === '-204') {
          obj.response = [];
          obj.rowCount = 0;
          return obj;
        }
      }
      throw this.handleError(execErr, obj.sql, obj.bindings);
    } finally {
      try {
        stmt.closeSync();
      } catch {}
    }
  }

  // Execute a SELECT (or other result-returning) query and fetch all rows.
  async _executeQuery(stmt, obj) {
    let result;
    try {
      result = await stmt.execute(obj.bindings || []);
    } catch (execErr) {
      try {
        stmt.closeSync();
      } catch {}
      throw this.handleError(execErr, obj.sql, obj.bindings);
    }
    try {
      const rows = result.fetchAllSync() || [];
      obj.response = rows;
      obj.rowCount = rows.length;
      return obj;
    } catch (fetchErr) {
      throw this.handleError(fetchErr, obj.sql, obj.bindings);
    } finally {
      try {
        result.closeSync();
      } catch {}
      try {
        stmt.closeSync();
      } catch {}
    }
  }

  // Execute query using DB2 with enhanced error handling.
  // Uses ibm_db's native Promise support (no callback passed → Promise returned).
  async query(connection, obj) {
    if (!obj.sql) throw new Error('The query is empty');

    // If connection.query is absent, fall through to prepare/executeNonQuery below.
    if (obj.__db2BulkInsert && typeof connection.query === 'function') {
      return this._executeBulkInsert(connection, obj);
    }

    const sqlTrimmed = obj.sql.trim().toLowerCase();
    const isDML = /^(insert|update|delete|merge)\b/.test(sqlTrimmed);
    const isDDL = /^(create|drop|alter|truncate|rename|comment|grant|revoke)\b/.test(sqlTrimmed);

    const executeQuery = async () => {
      let stmt;
      try {
        stmt = await connection.prepare(obj.sql);
      } catch (prepErr) {
        throw this.handleError(prepErr, obj.sql, obj.bindings);
      }

      if (isDML) {
        return this._executeDML(connection, stmt, obj);
      } else if (isDDL) {
        return this._executeDDL(stmt, obj);
      } else {
        return this._executeQuery(stmt, obj);
      }
    };

    const queryTimeout = this.config.connection?.queryTimeout;
    if (queryTimeout && queryTimeout > 0) {
      return Promise.race([
        executeQuery(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Query timeout after ${queryTimeout}ms: ${obj.sql.substring(0, 100)}...`)),
            queryTimeout
          )
        ),
      ]);
    }

    return executeQuery();
  }

  // Stream query results progressively using ibm_db's queryStream API.
  // Returns a Node.js Readable stream — rows are emitted one by one without
  // buffering the full result set in memory.
  stream(connection, obj, stream, _options) {
    const readable = connection.queryStream(obj.sql, obj.bindings || []);
    return readable.pipe(stream);
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
