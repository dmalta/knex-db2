// Unit tests for DB2 Client class
// These tests do not require a real database connection
const Db2Client = require('../../src/client');

describe('DB2 Client Unit Tests', () => {
  let client;

  beforeEach(() => {
    client = new Db2Client({ client: 'db2', connection: {} });
  });

  describe('Client Creation and Basic Properties', () => {
    test('should create client instance', () => {
      expect(client).toBeDefined();
      expect(client.constructor.name).toBe('Db2Client');
    });

    test('should have correct driver name', () => {
      expect(client.driverName).toBe('db2');
    });

    test('should have correct dialect', () => {
      expect(client.dialect).toBe('db2');
    });

    test('should have driver getter', () => {
      expect(client.driver).toBeDefined();
    });
  });

  describe('Identifier Wrapping', () => {
    test('should return identifiers as-is for DB2', () => {
      expect(client.wrapIdentifierImpl('table_name')).toBe('table_name');
      expect(client.wrapIdentifierImpl('column_name')).toBe('column_name');
      expect(client.wrapIdentifierImpl('SCHEMA')).toBe('SCHEMA');
    });

    test('should not wrap asterisk', () => {
      expect(client.wrapIdentifierImpl('*')).toBe('*');
    });

    test('should handle double quotes in identifiers', () => {
      expect(client.wrapIdentifierImpl('col"name')).toBe('col"name');
      expect(client.wrapIdentifierImpl('tab"le"name')).toBe('tab"le"name');
    });

    test('should handle empty and special identifiers', () => {
      expect(client.wrapIdentifierImpl('')).toBe('');
      expect(client.wrapIdentifierImpl('123table')).toBe('123table');
      expect(client.wrapIdentifierImpl('table-name')).toBe('table-name');
    });
  });

  describe('SQL Processing', () => {
    test('should handle position bindings', () => {
      const sql = 'SELECT * FROM table WHERE id = ? AND name = ?';
      expect(client.positionBindings(sql)).toBe(sql);
    });

    test('should handle complex SQL with multiple bindings', () => {
      const sql = 'INSERT INTO table (col1, col2, col3) VALUES (?, ?, ?)';
      expect(client.positionBindings(sql)).toBe(sql);
    });
  });

  describe('Validation Methods', () => {
    describe('validateConnection', () => {
      test('should return false for null/undefined connections', async () => {
        expect(await client.validateConnection(null)).toBe(false);
        expect(await client.validateConnection(undefined)).toBe(false);
      });

      test('should return false for disposed connections', async () => {
        const connection = { __knex__disposed: true, query: () => {}, close: () => {} };
        expect(await client.validateConnection(connection)).toBe(false);
      });

      test('should return false for connections without required methods', async () => {
        const connectionWithoutQuery = { __knex__disposed: false, close: () => {} };
        expect(await client.validateConnection(connectionWithoutQuery)).toBe(false);

        const connectionWithoutClose = {
          __knex__disposed: false,
          query: (sql, bindings, callback) => callback(null, [{ IBMREQD: 'Y' }]),
        };
        expect(await client.validateConnection(connectionWithoutClose)).toBe(false);
      });

      test('should return true for valid connection', async () => {
        const validConnection = {
          __knex__disposed: false,
          query: (sql, bindings, callback) => {
            callback(null, [{ IBMREQD: 'Y' }]);
          },
          close: () => {},
        };
        expect(await client.validateConnection(validConnection)).toBe(true);
      });

      test('should handle query errors gracefully', async () => {
        const connectionWithError = {
          __knex__disposed: false,
          query: (sql, bindings, callback) => {
            callback(new Error('Connection test failed'));
          },
          close: () => {},
        };
        expect(await client.validateConnection(connectionWithError)).toBe(false);
      });
    });
  });

  describe('Compiler Integration', () => {
    test('should have query compiler class', () => {
      const queryCompilerClass = client.queryCompiler;
      expect(queryCompilerClass).toBeDefined();
    });

    test('should have schema compiler class', () => {
      const schemaCompilerClass = client.schemaCompiler;
      expect(schemaCompilerClass).toBeDefined();
    });

    test('should have column compiler class', () => {
      const columnCompilerClass = client.columnCompiler;
      expect(columnCompilerClass).toBeDefined();
    });

    test('should have table compiler class', () => {
      const tableCompilerClass = client.tableCompiler;
      expect(tableCompilerClass).toBeDefined();
    });
  });

  describe('query DML path (executeNonQuery)', () => {
    function makeConnection({ dmlAffectedRows = 3 } = {}) {
      let capturedStmt;
      const conn = {
        __knex__disposed: false,
        prepare: vi.fn((sql) => {
          capturedStmt = {
            executeNonQuery: vi.fn((bindings) => Promise.resolve(dmlAffectedRows)),
            execute: vi.fn((bindings) => Promise.resolve({
              fetchAllSync: () => [],
              getColumnMetadataSync: () => [],
              closeSync: vi.fn(),
            })),
            closeSync: vi.fn(),
          };
          return Promise.resolve(capturedStmt);
        }),
        query: vi.fn(),
        close: vi.fn(),
      };
      conn._getStmt = () => capturedStmt;
      return conn;
    }

    test('INSERT uses executeNonQuery and returns rowCount', async () => {
      const conn = makeConnection({ dmlAffectedRows: 5 });
      const result = await client.query(conn, {
        sql: 'INSERT INTO users (name) VALUES (?)',
        bindings: ['Alice'],
      });
      expect(result.rowCount).toBe(5);
      expect(result.response).toEqual([]);
      const stmt = conn._getStmt();
      expect(stmt.executeNonQuery).toHaveBeenCalledTimes(1);
      expect(stmt.execute).not.toHaveBeenCalled();
    });

    test('UPDATE uses executeNonQuery', async () => {
      const conn = makeConnection({ dmlAffectedRows: 2 });
      const result = await client.query(conn, { sql: 'UPDATE users SET name=? WHERE id=?', bindings: ['Bob', 1] });
      expect(result.rowCount).toBe(2);
    });

    test('DELETE uses executeNonQuery', async () => {
      const conn = makeConnection({ dmlAffectedRows: 1 });
      const result = await client.query(conn, { sql: 'DELETE FROM users WHERE id=?', bindings: [1] });
      expect(result.rowCount).toBe(1);
    });

    test('SELECT does NOT use executeNonQuery', async () => {
      const conn = makeConnection();
      await client.query(conn, { sql: 'SELECT * FROM users' });
      const stmt = conn._getStmt();
      expect(stmt.execute).toHaveBeenCalledTimes(1);
      expect(stmt.executeNonQuery).not.toHaveBeenCalled();
    });
  });

  describe('stream (queryStream)', () => {
    test('pipes ibm_db queryStream into the provided writable stream', () => {
      const { Readable, Writable } = require('stream');

      const fakeReadable = new Readable({ objectMode: true, read() {} });
      const connection = {
        __knex__disposed: false,
        queryStream: vi.fn(() => fakeReadable),
        query: vi.fn(),
        close: vi.fn(),
      };

      const chunks = [];
      const dest = new Writable({
        objectMode: true,
        write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
      });

      client.stream(connection, { sql: 'SELECT * FROM users', bindings: [] }, dest);

      expect(connection.queryStream).toHaveBeenCalledWith('SELECT * FROM users', []);

      // Simulate rows arriving on the readable
      fakeReadable.push({ ID: 1 });
      fakeReadable.push({ ID: 2 });
      fakeReadable.push(null); // EOF

      return new Promise((resolve) => {
        dest.on('finish', () => {
          expect(chunks).toEqual([{ ID: 1 }, { ID: 2 }]);
          resolve();
        });
      });
    });
  });

  describe('bulk insert fast path', () => {
    function makeBulkObj() {
      return {
        sql: 'insert into users (id, name) values (?, ?)',
        bindings: [],
        __db2BulkInsert: {
          columns: ['id', 'name'],
          values: [
            [1, 'Alice'],
            [2, 'Bob'],
          ],
        },
      };
    }

    test('multi-row insert calls connection.query with ArraySize and column-wise ARRAY params', async () => {
      const conn = {
        __knex__disposed: false,
        query: vi.fn((opts, cb) => cb(null)),
        prepare: vi.fn(),
        close: vi.fn(),
      };

      const bulkObj = makeBulkObj();
      const result = await client.query(conn, bulkObj);

      // Fast path must call connection.query exactly once
      expect(conn.query).toHaveBeenCalledTimes(1);
      expect(conn.prepare).not.toHaveBeenCalled();

      const callArg = conn.query.mock.calls[0][0];
      expect(callArg.ArraySize).toBe(2);
      expect(callArg.sql).toBe('insert into users (id, name) values (?, ?)');

      // Column 0: id
      expect(callArg.params[0]).toMatchObject({
        ParamType: 'ARRAY',
        DataType: 1,
        Data: [1, 2],
      });

      // Column 1: name
      expect(callArg.params[1]).toMatchObject({
        ParamType: 'ARRAY',
        DataType: 1,
        Data: ['Alice', 'Bob'],
      });

      expect(result.response).toEqual([]);
      expect(result.rowCount).toBe(2);
    });

    test('single-row insert does NOT hit the fast path', async () => {
      const conn = {
        __knex__disposed: false,
        prepare: vi.fn((sql) =>
          Promise.resolve({
            executeNonQuery: vi.fn(() => Promise.resolve(1)),
            closeSync: vi.fn(),
          })
        ),
        query: vi.fn(),
        close: vi.fn(),
      };

      // Plain single-row obj — no __db2BulkInsert property
      const singleObj = {
        sql: 'insert into users (id, name) values (?, ?)',
        bindings: [3, 'Carol'],
      };

      const result = await client.query(conn, singleObj);

      expect(conn.query).not.toHaveBeenCalled();
      expect(conn.prepare).toHaveBeenCalledTimes(1);
      expect(result.rowCount).toBe(1);
      expect(result.response).toEqual([]);
    });

    test('fallback to serial path when connection.query is absent', async () => {
      const conn = {
        __knex__disposed: false,
        prepare: vi.fn((sql) =>
          Promise.resolve({
            executeNonQuery: vi.fn(() => Promise.resolve(2)),
            closeSync: vi.fn(),
          })
        ),
        // connection.query intentionally absent
        close: vi.fn(),
      };

      const bulkObj = {
        sql: 'insert into users (id, name) values (?, ?)',
        bindings: [],
        __db2BulkInsert: {
          columns: ['id', 'name'],
          values: [[4, 'Dave'], [5, 'Eve']],
        },
      };

      // Should not throw — falls through to prepare/executeNonQuery
      const result = await client.query(conn, bulkObj);
      expect(conn.prepare).toHaveBeenCalledTimes(1);
      expect(result.rowCount).toBe(2);
    });
  });

  describe('Connection lifecycle', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    describe('acquireRawConnection', () => {
      test('should successfully acquire connection with driver.open callback', async () => {
        const mockConn = {
          __knex__disposed: false,
          close: vi.fn((cb) => cb(null)),
          query: vi.fn(),
        };
        client.driver.open = vi.fn((connStr, cb) => {
          setTimeout(() => cb(null, mockConn), 0);
        });

        const conn = await client.acquireRawConnection();

        expect(conn).toBeDefined();
        expect(conn.__knex__acquired).toBeInstanceOf(Date);
        expect(conn.__knex__db2_client).toBe(client);
        expect(conn.__knex__autocommit).toBe(true);
      });

      test('should handle error from driver.open', async () => {
        const dbError = { message: 'Connection failed', sqlcode: -30081 };
        client.driver.open = vi.fn((connStr, cb) => {
          setTimeout(() => cb(dbError, null), 0);
        });

        await expect(client.acquireRawConnection()).rejects.toBeDefined();
      });

      test('should reject with timeout after connectionTimeout ms', async () => {
        vi.useFakeTimers();
        const clientWithTimeout = new Db2Client({
          client: 'db2',
          connection: { connectionTimeout: 50 },
        });

        clientWithTimeout.driver.open = vi.fn((_connStr, _cb) => {
          // never calls the callback
        });

        const promise = clientWithTimeout.acquireRawConnection();
        vi.advanceTimersByTime(100);

        await expect(promise).rejects.toThrow(/Connection timeout/);
      });

      test('should handle connection timeout at 0 (no timeout)', async () => {
        const clientNoTimeout = new Db2Client({
          client: 'db2',
          connection: { connectionTimeout: 0 },
        });

        const mockConn = {
          __knex__disposed: false,
          close: vi.fn((cb) => cb(null)),
          query: vi.fn(),
        };

        clientNoTimeout.driver.open = vi.fn((connStr, cb) => {
          setTimeout(() => cb(null, mockConn), 10);
        });

        const conn = await clientNoTimeout.acquireRawConnection();
        expect(conn).toBeDefined();
      });
    });

    describe('buildConnectionString', () => {
      test('should include required connection parameters', () => {
        const settings = {
          database: 'TESTDB',
          hostname: 'localhost',
          port: 50000,
          user: 'db2user',
          password: 'pass123',
        };

        const connStr = client.buildConnectionString(settings);

        expect(connStr).toContain('DRIVER=IBM DB2 ODBC DRIVER');
        expect(connStr).toContain('DATABASE=TESTDB');
        expect(connStr).toContain('HOSTNAME=localhost');
        expect(connStr).toContain('PORT=50000');
        expect(connStr).toContain('PROTOCOL=TCPIP');
        expect(connStr).toContain('UID=db2user');
        expect(connStr).toContain('PWD=pass123');
      });

      test('should use uid fallback when user is absent', () => {
        const settings = {
          database: 'TESTDB',
          hostname: 'localhost',
          port: 50000,
          uid: 'dbadmin',
          pwd: 'secret',
        };

        const connStr = client.buildConnectionString(settings);

        expect(connStr).toContain('UID=dbadmin');
        expect(connStr).toContain('PWD=secret');
      });

      test('should include schema when provided', () => {
        const settings = {
          database: 'TESTDB',
          hostname: 'localhost',
          port: 50000,
          user: 'db2user',
          password: 'pass123',
          schema: 'MYSCHEMA',
        };

        const connStr = client.buildConnectionString(settings);

        expect(connStr).toContain('CURRENTSCHEMA=MYSCHEMA');
      });

      test('should include connectTimeout when provided', () => {
        const settings = {
          database: 'TESTDB',
          hostname: 'localhost',
          port: 50000,
          user: 'db2user',
          password: 'pass123',
          connectTimeout: 30,
        };

        const connStr = client.buildConnectionString(settings);

        expect(connStr).toContain('CONNECTTIMEOUT=30');
      });

      test('should include queryTimeout when provided', () => {
        const settings = {
          database: 'TESTDB',
          hostname: 'localhost',
          port: 50000,
          user: 'db2user',
          password: 'pass123',
          queryTimeout: 60,
        };

        const connStr = client.buildConnectionString(settings);

        expect(connStr).toContain('QUERYTIMEOUT=60');
      });

      test('should include SSL security when set', () => {
        const settings = {
          database: 'TESTDB',
          hostname: 'localhost',
          port: 50000,
          user: 'db2user',
          password: 'pass123',
          security: 'SSL',
        };

        const connStr = client.buildConnectionString(settings);

        expect(connStr).toContain('SECURITY=SSL');
      });

      test('should include all optional parameters together', () => {
        const settings = {
          database: 'TESTDB',
          hostname: 'localhost',
          port: 50000,
          user: 'db2user',
          password: 'pass123',
          schema: 'PROD',
          connectTimeout: 30,
          queryTimeout: 120,
          security: 'SSL',
        };

        const connStr = client.buildConnectionString(settings);

        expect(connStr).toContain('CURRENTSCHEMA=PROD');
        expect(connStr).toContain('CONNECTTIMEOUT=30');
        expect(connStr).toContain('QUERYTIMEOUT=120');
        expect(connStr).toContain('SECURITY=SSL');
        expect(connStr).toMatch(/;$/); // ends with semicolon
      });

      test('should exclude optional parameters when not provided', () => {
        const settings = {
          database: 'TESTDB',
          hostname: 'localhost',
          port: 50000,
          user: 'db2user',
          password: 'pass123',
        };

        const connStr = client.buildConnectionString(settings);

        expect(connStr).not.toContain('CURRENTSCHEMA');
        expect(connStr).not.toContain('CONNECTTIMEOUT');
        expect(connStr).not.toContain('QUERYTIMEOUT');
        expect(connStr).not.toContain('SECURITY=SSL');
      });
    });

    describe('setConnectionOptions', () => {
      test('should set autocommit to true by default', () => {
        const connection = {};
        client.setConnectionOptions(connection);

        expect(connection.__knex__autocommit).toBe(true);
      });

      test('should respect autocommit false configuration', () => {
        const clientWithAutocommitFalse = new Db2Client({
          client: 'db2',
          connection: { autocommit: false },
        });

        const connection = {};
        clientWithAutocommitFalse.setConnectionOptions(connection);

        expect(connection.__knex__autocommit).toBe(false);
      });

      test('should set autocommit to true when explicitly true', () => {
        const clientWithAutocommitTrue = new Db2Client({
          client: 'db2',
          connection: { autocommit: true },
        });

        const connection = {};
        clientWithAutocommitTrue.setConnectionOptions(connection);

        expect(connection.__knex__autocommit).toBe(true);
      });
    });

    describe('destroyRawConnection', () => {
      test('should resolve immediately for already-disposed connections', async () => {
        const connection = {
          __knex__disposed: true,
          close: vi.fn(),
        };

        await client.destroyRawConnection(connection);

        expect(connection.close).not.toHaveBeenCalled();
      });

      test('should successfully close active connections', async () => {
        const connection = {
          __knex__disposed: false,
          close: vi.fn((cb) => cb(null)),
        };

        await client.destroyRawConnection(connection);

        expect(connection.close).toHaveBeenCalled();
        expect(connection.__knex__disposed).toBe(true);
      });

      test('should mark connection as disposed before closing', async () => {
        let disposedValueOnClose;
        const connection = {
          __knex__disposed: false,
          close: vi.fn((cb) => {
            disposedValueOnClose = connection.__knex__disposed;
            cb(null);
          }),
        };

        await client.destroyRawConnection(connection);

        expect(disposedValueOnClose).toBe(true);
      });

      test('should reject when close callback returns error', async () => {
        const closeError = { message: 'Close failed', sqlcode: -999 };
        const connection = {
          __knex__disposed: false,
          close: vi.fn((cb) => cb(closeError)),
        };

        await expect(client.destroyRawConnection(connection)).rejects.toBeDefined();
      });

      test('should reject on close timeout', async () => {
        vi.useFakeTimers();

        const connection = {
          __knex__disposed: false,
          close: vi.fn((_cb) => {
            // never calls callback
          }),
        };

        const promise = client.destroyRawConnection(connection);
        vi.advanceTimersByTime(6000);

        await expect(promise).rejects.toThrow(/close timeout/);
      });
    });
  });

  describe('Query execution paths', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    describe('_executeDML', () => {
      test('should return rowCount for successful DML', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.resolve(5)),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'UPDATE users SET active=1', bindings: [], response: [] };
        const conn = { __knex__disposed: false };

        const result = await client._executeDML(conn, stmt, obj);

        expect(result.rowCount).toBe(5);
        expect(result.response).toEqual([]);
        expect(stmt.closeSync).toHaveBeenCalled();
      });

      test('should handle positive SQLCODE as warning and mark connection disposed', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.reject({ sqlcode: 513 })),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'DELETE FROM users', bindings: [], response: [] };
        const conn = { __knex__disposed: false };

        const result = await client._executeDML(conn, stmt, obj);

        expect(conn.__knex__disposed).toBe(true);
        expect(result.rowCount).toBe(0);
        expect(result.response).toEqual([]);
      });

      test('should reject on negative SQLCODE', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.reject({ sqlcode: -803, message: 'Duplicate key' })),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'INSERT INTO users VALUES (1)', bindings: [], response: [] };
        const conn = { __knex__disposed: false };

        await expect(client._executeDML(conn, stmt, obj)).rejects.toBeDefined();
      });

      test('should call closeSync even on error', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.reject(new Error('Statement error'))),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'UPDATE users', bindings: [], response: [] };
        const conn = { __knex__disposed: false };

        try {
          await client._executeDML(conn, stmt, obj);
        } catch (e) {
          // expected to reject
        }

        expect(stmt.closeSync).toHaveBeenCalled();
      });

      test('should handle executeNonQuery returning 0', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.resolve(0)),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'UPDATE users WHERE 1=0', bindings: [], response: [] };
        const conn = { __knex__disposed: false };

        const result = await client._executeDML(conn, stmt, obj);

        expect(result.rowCount).toBe(0);
      });

      test('should handle executeNonQuery with no return value (becomes 0)', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.resolve(null)),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'UPDATE users WHERE 1=0', bindings: [], response: [] };
        const conn = { __knex__disposed: false };

        const result = await client._executeDML(conn, stmt, obj);

        expect(result.rowCount).toBe(0);
      });
    });

    describe('_executeDDL', () => {
      test('should resolve with rowCount 0 for successful DDL', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.resolve()),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'CREATE TABLE test (id INT)', bindings: [], response: [] };

        const result = await client._executeDDL(stmt, obj);

        expect(result.rowCount).toBe(0);
        expect(result.response).toEqual([]);
        expect(stmt.closeSync).toHaveBeenCalled();
      });

      test('should suppress -204 error when suppressIfNotFound=true', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.reject({ sqlcode: -204 })),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'DROP TABLE nonexistent', bindings: [], suppressIfNotFound: true, response: [] };

        const result = await client._executeDDL(stmt, obj);

        expect(result.rowCount).toBe(0);
        expect(result.response).toEqual([]);
      });

      test('should suppress -204 as string when suppressIfNotFound=true', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.reject({ sqlcode: '-204' })),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'DROP TABLE nonexistent', bindings: [], suppressIfNotFound: true, response: [] };

        const result = await client._executeDDL(stmt, obj);

        expect(result.rowCount).toBe(0);
      });

      test('should reject non-204 errors even if suppressIfNotFound=true', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.reject({ sqlcode: -201, message: 'Other error' })),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'DROP TABLE test', bindings: [], suppressIfNotFound: true, response: [] };

        await expect(client._executeDDL(stmt, obj)).rejects.toBeDefined();
      });

      test('should reject -204 when suppressIfNotFound=false', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.reject({ sqlcode: -204 })),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'DROP TABLE test', bindings: [], suppressIfNotFound: false, response: [] };

        await expect(client._executeDDL(stmt, obj)).rejects.toBeDefined();
      });

      test('should reject when suppressIfNotFound is not set', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.reject({ sqlcode: -204 })),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'DROP TABLE test', bindings: [], response: [] };

        await expect(client._executeDDL(stmt, obj)).rejects.toBeDefined();
      });

      test('should call closeSync even on error', async () => {
        const stmt = {
          executeNonQuery: vi.fn(() => Promise.reject(new Error('DDL error'))),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'ALTER TABLE test', bindings: [], response: [] };

        try {
          await client._executeDDL(stmt, obj);
        } catch (e) {
          // expected
        }

        expect(stmt.closeSync).toHaveBeenCalled();
      });
    });

    describe('_executeQuery', () => {
      test('should return all fetched rows', async () => {
        const mockResult = {
          fetchAllSync: vi.fn(() => [{ ID: 1 }, { ID: 2 }, { ID: 3 }]),
          closeSync: vi.fn(),
        };

        const stmt = {
          execute: vi.fn(() => Promise.resolve(mockResult)),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'SELECT * FROM users', bindings: [], response: undefined };

        const result = await client._executeQuery(stmt, obj);

        expect(result.response).toEqual([{ ID: 1 }, { ID: 2 }, { ID: 3 }]);
        expect(result.rowCount).toBe(3);
      });

      test('should handle empty result set', async () => {
        const mockResult = {
          fetchAllSync: vi.fn(() => []),
          closeSync: vi.fn(),
        };

        const stmt = {
          execute: vi.fn(() => Promise.resolve(mockResult)),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'SELECT * FROM users WHERE 1=0', bindings: [], response: undefined };

        const result = await client._executeQuery(stmt, obj);

        expect(result.response).toEqual([]);
        expect(result.rowCount).toBe(0);
      });

      test('should reject when fetchAllSync throws', async () => {
        const mockResult = {
          fetchAllSync: vi.fn(() => {
            throw new Error('Fetch failed');
          }),
          closeSync: vi.fn(),
        };

        const stmt = {
          execute: vi.fn(() => Promise.resolve(mockResult)),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'SELECT * FROM users', bindings: [], response: undefined };

        await expect(client._executeQuery(stmt, obj)).rejects.toThrow();
      });

      test('should close result even when fetchAllSync throws', async () => {
        const mockResult = {
          fetchAllSync: vi.fn(() => {
            throw new Error('Fetch failed');
          }),
          closeSync: vi.fn(),
        };

        const stmt = {
          execute: vi.fn(() => Promise.resolve(mockResult)),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'SELECT * FROM users', bindings: [], response: undefined };

        try {
          await client._executeQuery(stmt, obj);
        } catch (e) {
          // expected
        }

        expect(mockResult.closeSync).toHaveBeenCalled();
        expect(stmt.closeSync).toHaveBeenCalled();
      });

      test('should reject and close on execute error', async () => {
        const stmt = {
          execute: vi.fn(() => Promise.reject(new Error('Execute failed'))),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'SELECT * FROM users', bindings: [], response: undefined };

        await expect(client._executeQuery(stmt, obj)).rejects.toThrow();
        expect(stmt.closeSync).toHaveBeenCalled();
      });

      test('should handle fetchAllSync returning null or undefined', async () => {
        const mockResult = {
          fetchAllSync: vi.fn(() => null),
          closeSync: vi.fn(),
        };

        const stmt = {
          execute: vi.fn(() => Promise.resolve(mockResult)),
          closeSync: vi.fn(),
        };

        const obj = { sql: 'SELECT * FROM users', bindings: [], response: undefined };

        const result = await client._executeQuery(stmt, obj);

        expect(result.response).toEqual([]);
      });
    });

    describe('query timeout', () => {
      test('should use Promise.race with timeout when queryTimeout is set', async () => {
        vi.useFakeTimers();

        const clientWithTimeout = new Db2Client({
          client: 'db2',
          connection: { queryTimeout: 50 },
        });

        const connection = {
          __knex__disposed: false,
          prepare: vi.fn(() => new Promise(() => {
            // never resolves
          })),
        };

        const promise = clientWithTimeout.query(connection, { sql: 'SELECT * FROM users' });

        vi.advanceTimersByTime(100);

        await expect(promise).rejects.toThrow(/Query timeout after 50ms/);
      });

      test('should not apply timeout when queryTimeout is 0', async () => {
        const clientNoTimeout = new Db2Client({
          client: 'db2',
          connection: { queryTimeout: 0 },
        });

        const connection = {
          __knex__disposed: false,
          prepare: vi.fn((sql) =>
            Promise.resolve({
              execute: vi.fn(() => Promise.resolve({ fetchAllSync: () => [{ ID: 1 }], closeSync: () => {} })),
              closeSync: vi.fn(),
            })
          ),
        };

        const result = await clientNoTimeout.query(connection, { sql: 'SELECT * FROM users' });

        expect(result.response).toEqual([{ ID: 1 }]);
      });

      test('should not apply timeout when queryTimeout is undefined', async () => {
        const clientNoTimeout = new Db2Client({
          client: 'db2',
          connection: {},
        });

        const connection = {
          __knex__disposed: false,
          prepare: vi.fn((sql) =>
            Promise.resolve({
              execute: vi.fn(() => Promise.resolve({ fetchAllSync: () => [{ ID: 2 }], closeSync: () => {} })),
              closeSync: vi.fn(),
            })
          ),
        };

        const result = await clientNoTimeout.query(connection, { sql: 'SELECT * FROM users' });

        expect(result.response).toEqual([{ ID: 2 }]);
      });

      test('should pass through successful query result before timeout', async () => {
        const clientWithTimeout = new Db2Client({
          client: 'db2',
          connection: { queryTimeout: 5000 },
        });

        const connection = {
          __knex__disposed: false,
          prepare: vi.fn((sql) =>
            Promise.resolve({
              execute: vi.fn(() =>
                Promise.resolve({
                  fetchAllSync: () => [{ ID: 50 }],
                  closeSync: () => {},
                })
              ),
              closeSync: vi.fn(),
            })
          ),
        };

        const result = await clientWithTimeout.query(connection, { sql: 'SELECT * FROM users' });

        expect(result.response).toEqual([{ ID: 50 }]);
      });
    });

    describe('processResponse', () => {
      test('should return undefined for null object', () => {
        expect(client.processResponse(null)).toBeUndefined();
      });

      test('should return undefined for undefined object', () => {
        expect(client.processResponse(undefined)).toBeUndefined();
      });

      test('should call obj.output with runner context when provided', () => {
        const outputFn = vi.fn(() => 'custom output');
        const runner = { some: 'runner' };
        const obj = { output: outputFn, response: [{ ID: 1 }] };

        const result = client.processResponse(obj, runner);

        expect(outputFn).toHaveBeenCalledWith([{ ID: 1 }]);
        expect(result).toBe('custom output');
      });

      test('should return response array for select method', () => {
        const obj = {
          method: 'select',
          response: [{ ID: 1 }, { ID: 2 }],
        };

        const result = client.processResponse(obj);

        expect(result).toEqual([{ ID: 1 }, { ID: 2 }]);
      });

      test('should return first row for first method', () => {
        const obj = {
          method: 'first',
          response: [{ ID: 1, name: 'Alice' }, { ID: 2, name: 'Bob' }],
        };

        const result = client.processResponse(obj);

        expect(result).toEqual({ ID: 1, name: 'Alice' });
      });

      test('should return undefined for first method with empty response', () => {
        const obj = {
          method: 'first',
          response: [],
        };

        const result = client.processResponse(obj);

        expect(result).toBeUndefined();
      });

      test('should pluck column values for pluck method', () => {
        const obj = {
          method: 'pluck',
          pluck: 'name',
          response: [{ ID: 1, name: 'Alice' }, { ID: 2, name: 'Bob' }, { ID: 3, name: 'Carol' }],
        };

        const result = client.processResponse(obj);

        expect(result).toEqual(['Alice', 'Bob', 'Carol']);
      });

      test('should pluck non-string columns', () => {
        const obj = {
          method: 'pluck',
          pluck: 'ID',
          response: [{ ID: 1, name: 'Alice' }, { ID: 2, name: 'Bob' }],
        };

        const result = client.processResponse(obj);

        expect(result).toEqual([1, 2]);
      });

      test('should return rowCount for insert without returning', () => {
        const obj = {
          method: 'insert',
          rowCount: 3,
          response: [],
        };

        const result = client.processResponse(obj);

        expect(result).toBe(3);
      });

      test('should return response for insert with returning', () => {
        const obj = {
          method: 'insert',
          returning: ['id'],
          rowCount: 2,
          response: [{ id: 10 }, { id: 11 }],
        };

        const result = client.processResponse(obj);

        expect(result).toEqual([{ id: 10 }, { id: 11 }]);
      });

      test('should return rowCount for del without returning', () => {
        const obj = {
          method: 'del',
          rowCount: 5,
          response: [],
        };

        const result = client.processResponse(obj);

        expect(result).toBe(5);
      });

      test('should return response for del with returning', () => {
        const obj = {
          method: 'del',
          returning: ['id'],
          rowCount: 2,
          response: [{ id: 10 }, { id: 11 }],
        };

        const result = client.processResponse(obj);

        expect(result).toEqual([{ id: 10 }, { id: 11 }]);
      });

      test('should return rowCount for update without returning', () => {
        const obj = {
          method: 'update',
          rowCount: 1,
          response: [],
        };

        const result = client.processResponse(obj);

        expect(result).toBe(1);
      });

      test('should return response for update with returning', () => {
        const obj = {
          method: 'update',
          returning: ['id'],
          rowCount: 1,
          response: [{ id: 10 }],
        };

        const result = client.processResponse(obj);

        expect(result).toEqual([{ id: 10 }]);
      });

      test('should return rowCount for counter without returning', () => {
        const obj = {
          method: 'counter',
          rowCount: 42,
          response: [],
        };

        const result = client.processResponse(obj);

        expect(result).toBe(42);
      });

      test('should return response for counter with returning', () => {
        const obj = {
          method: 'counter',
          returning: true,
          rowCount: 1,
          response: [{ count: 42 }],
        };

        const result = client.processResponse(obj);

        expect(result).toEqual([{ count: 42 }]);
      });

      test('should return response for unknown method', () => {
        const obj = {
          method: 'unknown',
          response: [{ ID: 1 }],
        };

        const result = client.processResponse(obj);

        expect(result).toEqual([{ ID: 1 }]);
      });

      test('should return response when method is not set', () => {
        const obj = {
          response: [{ ID: 1, name: 'test' }],
        };

        const result = client.processResponse(obj);

        expect(result).toEqual([{ ID: 1, name: 'test' }]);
      });
    });
  });
});
