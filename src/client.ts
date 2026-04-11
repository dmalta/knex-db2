import type { Knex } from 'knex';
import { Db2QueryCompiler } from './query/db2-querycompiler';
import { Db2ColumnCompiler } from './schema/db2-columncompiler';
import { handleDB2Error, DB2_ERROR_MAP } from './db2-errors';
import type { Db2ConnectionConfig, DbQueryResult, Db2Connection } from './types';

// Import Knex Client class properly for ESM
import Client = require('knex/lib/client');
import { timeout, KnexTimeoutError } from 'knex/lib/util/timeout';

// Import ibm_db types
import type { Database, ODBCResult } from 'ibm_db';

// Dynamic import for ibm_db with proper typing
let ibmDb: typeof import('ibm_db') | null = null;

async function getIbmDb(): Promise<typeof import('ibm_db')> {
  if (ibmDb) return ibmDb;
  
  try {
    ibmDb = await import('ibm_db');
  } catch {
    // Mock ibm_db when native bindings aren't available  
    ibmDb = {
      open: (_connStr: string, callback: (err: Error | null, db?: Database) => void) => {
        callback(new Error('ibm_db native bindings not available - using mock'));
      },
    } as any;
  }
  return ibmDb!;
}

export default class Db2Client extends Client {
  public readonly dialect = 'db2' as const;
  public readonly driverName = 'db2' as const;
  public declare config: Knex.Config;

  constructor(config: Knex.Config = {} as Knex.Config) {
    // Ensure client is set to avoid deprecation warning
    if (!config.client) {
      config.client = 'db2';
    }
    super(config);
  }

  protected async _driver(): Promise<typeof import('ibm_db')> {
    return await getIbmDb();
  }

  public queryCompiler(builder: any, formatter?: any): any {
    return new Db2QueryCompiler(this as any, builder, formatter);
  }

  public columnCompiler(tableBuilder: any, columnBuilder: any): any {
    return new Db2ColumnCompiler(this as any, tableBuilder, columnBuilder);
  }

  public wrapIdentifierImpl(value: string): string {
    return value;
  }

  // DB2 Error Code Mapping - delegated to db2-errors module
  public getErrorMap(): Record<string, string> {
    const errorMap: Record<string, string> = {};
    for (const [code, mapping] of Object.entries(DB2_ERROR_MAP)) {
      errorMap[code] = mapping.type;
    }
    return errorMap;
  }

  // Enhanced error handling - delegated to db2-errors module
  public handleError(error: any, sql?: string, bindings?: any[]): any {
    const db2Error = handleDB2Error(error, sql, bindings);
    
    // Ensure sqlCode property (with capital C) for compatibility
    if (db2Error.sqlcode !== undefined) {
      (db2Error as any).sqlCode = db2Error.sqlcode;
    }
    
    // Ensure sqlState property for compatibility
    if (db2Error.sqlstate !== undefined) {
      (db2Error as any).sqlState = db2Error.sqlstate;
    }
    
    return db2Error;
  }

  // Get a raw connection for DB2 with enhanced error handling
  public async acquireRawConnection(): Promise<Db2Connection> {
    // Use this.config.connection directly to ensure we get all fields including password
    const connectionSettings = this.config.connection as Db2ConnectionConfig;

    return new Promise(async (resolve, reject) => {
      try {
        // Ensure driver is loaded
        const driver = await getIbmDb();
        
        // Build DB2 connection string with additional options
        const connStr = this.buildConnectionString(connectionSettings);

        const connectionTimeout = connectionSettings.connectionTimeout || 10000;
        let timeoutHandle: NodeJS.Timeout | undefined;

        // Set connection timeout
        if (connectionTimeout > 0) {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Connection timeout after ${connectionTimeout}ms`));
          }, connectionTimeout);
        }

        driver.open(connStr, (err: Error | null, connection?: Db2Connection) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);

          if (err) {
            const enhancedError = this.handleError(err);
            return reject(enhancedError);
          }

          if (!connection) {
            return reject(new Error('Failed to establish connection'));
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
  private buildConnectionString(settings: Db2ConnectionConfig): string {
    const options = [
      'DRIVER=IBM DB2 ODBC DRIVER',
      `DATABASE=${settings.database}`,
      `HOSTNAME=${settings.hostname}`,
      `PORT=${settings.port || 50000}`,
      'PROTOCOL=TCPIP',
      `UID=${settings.user}`,
      `PWD=${settings.password}`,
    ];

    // Add optional connection parameters
    if (settings.schema) options.push(`CURRENTSCHEMA=${settings.schema}`);
    if (settings.connectTimeout) options.push(`CONNECTTIMEOUT=${settings.connectTimeout}`);
    if (settings.queryTimeout) options.push(`QUERYTIMEOUT=${settings.queryTimeout}`);
    if (settings.security === 'SSL') options.push('SECURITY=SSL');

    return options.join(';') + ';';
  }

  // Set DB2-specific connection options
  private setConnectionOptions(connection: Db2Connection): void {
    // Set autocommit mode (default: true for Knex compatibility)
    const autocommit = (this.config.connection as Db2ConnectionConfig)?.autocommit !== false;

    // Note: ibm_db handles autocommit differently, this is a placeholder
    // for when we need to set specific DB2 connection attributes
    connection.__knex__autocommit = autocommit;
  }

  // Enhanced connection closing with proper cleanup
  public destroyRawConnection(connection: Db2Connection): Promise<void> {
    if (connection.__knex__disposed) {
      return Promise.resolve();
    }

    // Mark as disposed immediately to prevent reuse
    connection.__knex__disposed = true;

    return new Promise<void>((resolve, reject) => {
      // Close with timeout
      const closeTimeout = setTimeout(() => {
        reject(new Error('Connection close timeout'));
      }, 5000);

      connection.close((err: Error | null) => {
        clearTimeout(closeTimeout);
        if (err) {
          const enhancedError = this.handleError(err);
          return reject(enhancedError);
        }
        resolve();
      });
    })
    .then(function() {
      return;
    })
    .catch((error) => {
      throw error;
    });
  }

  public async validateConnection(connection: Db2Connection): Promise<boolean> {
    if (!connection || connection.__knex__disposed) {
      return false;
    }

    // Check if connection has required DB2 methods (including prepare for metadata)
    if (typeof connection.query !== 'function' || 
        typeof connection.close !== 'function' ||
        typeof connection.prepare !== 'function') {
      return false;
    }

    // For synchronous validation, we can't do a real query
    // Just check if the connection looks valid
    return true;
  }

  // Test the connection with a simple query
  public async testConnection(connection: Db2Connection): Promise<boolean> {
    try {
      const result = await this._query(connection, { sql: 'SELECT 1 FROM SYSIBM.SYSDUMMY1' });
      return result.rows.length > 0;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  // Execute query using DB2 with enhanced error handling and column metadata
  public _query(connection: Db2Connection, queryObject: any): Promise<DbQueryResult> {
    if (!queryObject.sql) throw new Error('The query is empty');

    const sqlTrimmed = queryObject.sql.trim().toLowerCase();
    // Determine if we need column metadata (mainly for SELECT queries)
    const needsMetadata = sqlTrimmed.startsWith('select');
    // DML statements don't produce a result set — use executeNonQuery for efficiency
    const isDML = /^(insert|update|delete|merge)\b/.test(sqlTrimmed);

    // Create the base query promise using prepare/execute pattern
    const queryPromise = new Promise<DbQueryResult>((resolve, reject) => {
      // Step 1: Prepare the statement
      connection.prepare(queryObject.sql, (err: Error | null, stmt?: any) => {
        if (err) {
          const enhancedError = this.handleError(err, queryObject.sql, queryObject.bindings);
          return reject(enhancedError);
        }

        if (!stmt) {
          return reject(new Error('Failed to prepare statement'));
        }

        if (isDML) {
          // Step 2a: Use executeNonQuery for DML — returns affected row count directly,
          // avoids allocating an unnecessary result-set buffer.
          stmt.executeNonQuery(queryObject.bindings || [], (execErr: Error | null, affectedRows?: number) => {
            try { stmt.closeSync(); } catch {}
            if (execErr) {
              const enhancedError = this.handleError(execErr, queryObject.sql, queryObject.bindings);
              return reject(enhancedError);
            }
            resolve({
              rows: [],
              rowCount: typeof affectedRows === 'number' ? affectedRows : 0,
            });
          });
        } else {
          // Step 2b: Execute the prepared statement for SELECT / DDL / CALL
          stmt.execute(queryObject.bindings || [], (execErr: Error | null, result?: ODBCResult) => {
            if (execErr) {
              // Clean up statement before rejecting
              try { stmt.closeSync(); } catch {}
              const enhancedError = this.handleError(execErr, queryObject.sql, queryObject.bindings);
              return reject(enhancedError);
            }

            if (!result) {
              try { stmt.closeSync(); } catch {}
              return reject(new Error('No result from statement execution'));
            }

            try {
              // Step 3: Get all rows using fetchAllSync
              const rows = result.fetchAllSync() || [];

              // Step 4: Get column metadata (only for SELECT queries)
              let columnMetadata: any[] | undefined;
              if (needsMetadata) {
                try {
                  columnMetadata = result.getColumnMetadataSync();
                } catch (metaErr) {
                  // If column metadata fails, continue without it
                  console.warn('Could not retrieve column metadata:', metaErr);
                  columnMetadata = undefined;
                }
              }

              // Step 5: Clean up
              try { result.closeSync(); } catch {}
              try { stmt.closeSync(); } catch {}

              // Create response using our DbQueryResult format with metadata
              const response: DbQueryResult = {
                rows: rows,
                rowCount: Array.isArray(rows) ? rows.length : 0,
                ...(columnMetadata ? { columns: columnMetadata } : {})
              };

              resolve(response);
            } catch (fetchErr) {
              // Ensure cleanup on any error
              try { result.closeSync(); } catch {}
              try { stmt.closeSync(); } catch {}

              const enhancedError = this.handleError(fetchErr as Error, queryObject.sql, queryObject.bindings);
              reject(enhancedError);
            }
          });
        }
      });
    });

    // Apply timeout if specified, using Knex's timeout utility
    const queryTimeout = (this.config.connection as Db2ConnectionConfig)?.queryTimeout || queryObject.timeout;
    if (queryTimeout && queryTimeout > 0) {
      return timeout(queryPromise, queryTimeout)
        .catch((error: any) => {
          if (error instanceof KnexTimeoutError) {
            // Enhance timeout error with more context
            throw Object.assign(error, {
              message: `Query timeout after ${queryTimeout}ms: ${queryObject.sql?.substring(0, 100)}...`,
              sql: queryObject.sql,
              bindings: queryObject.bindings,
              timeout: queryTimeout
            });
          }
          throw error;
        });
    }

    return queryPromise;
  }

  // Stream query results progressively using ibm_db's queryStream API.
  // Returns a Node.js Readable stream — rows are emitted one by one without
  // buffering the full result set in memory.
  public stream(connection: Db2Connection, queryObject: any, passedStream: any, _options?: any): any {
    const readable = (connection as any).queryStream(queryObject.sql, queryObject.bindings || []);
    return readable.pipe(passedStream);
  }

  // Process the response as returned from the query
  public processResponse(obj: any, runner: any): any {
    if (obj == null) return;
    
    // Extract rows from our DbQueryResult format
    const rows = obj.rows || obj.response || []; // Support both new and legacy format
    const { method } = obj;

    if (obj.output) {
      return obj.output.call(runner, rows);
    }

    // DB2 result processing - working with rows array
    switch (method) {
      case 'select':
        return rows;
      case 'first':
        return rows[0];
      case 'pluck':
        return rows.map((row: any) => row[obj.pluck]);
      case 'insert':
      case 'del':
      case 'update':
      case 'counter':
        if (obj.returning) {
          return rows;
        }
        return obj.rowCount || 0;
      default:
        return rows;
    }
  }
}
