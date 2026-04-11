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
});
