'use strict';
const knex = require('knex');
const Db2Client = require('../../client');
const { Db2Transaction } = require('../../transaction');

let db;
beforeAll(() => {
  db = knex({ client: Db2Client, connection: {}, pool: { min: 0 } });
});
afterAll(async () => { await db.destroy(); });

describe('Db2TableCompiler', () => {
  const ddl    = (fn) => db.schema.createTable('users', fn).toSQL();
  const alter  = (fn) => db.schema.table('users', fn).toSQL();
  const joinSql = (stmts) => stmts.map((s) => s.sql || s).join(' ');

  test('createTable emits CREATE TABLE without IF NOT EXISTS', () => {
    const sql = joinSql(ddl((t) => t.integer('id')));
    expect(sql).toMatch(/CREATE TABLE users/i);
    expect(sql).not.toContain('IF NOT EXISTS');
  });

  test('addColumn emits ALTER TABLE ... ADD COLUMN', () => {
    const sql = joinSql(alter((t) => t.integer('age')));
    expect(sql).toMatch(/ALTER TABLE users ADD COLUMN age integer/i);
  });

  test('dropColumn emits ALTER TABLE ... DROP COLUMN', () => {
    const sql = joinSql(alter((t) => t.dropColumn('age')));
    expect(sql).toMatch(/ALTER TABLE users DROP COLUMN age/i);
  });

  test('renameColumn emits RENAME COLUMN old TO new', () => {
    const sql = joinSql(alter((t) => t.renameColumn('old_name', 'new_name')));
    expect(sql).toMatch(/ALTER TABLE users RENAME COLUMN old_name TO new_name/i);
  });

  test('index() emits CREATE INDEX name ON table (col)', () => {
    const sql = joinSql(alter((t) => t.index('email', 'idx_email')));
    expect(sql).toMatch(/CREATE INDEX idx_email ON users \(email\)/i);
  });

  test('dropIndex() emits DROP INDEX without ON table clause', () => {
    const sql = joinSql(alter((t) => t.dropIndex('email', 'idx_email')));
    expect(sql).toMatch(/DROP INDEX idx_email/i);
    expect(sql).not.toMatch(/ON users/i);
  });

  test('comment() emits COMMENT ON TABLE ... IS', () => {
    const sql = joinSql(
      db.schema.createTable('users', (t) => {
        t.integer('id');
        t.comment('Users table');
      }).toSQL()
    );
    expect(sql).toMatch(/COMMENT ON TABLE users IS 'Users table'/i);
  });
});

describe('Db2Transaction', () => {
  let mockConnection;

  beforeEach(() => {
    mockConnection = {
      beginTransaction:    jest.fn(() => Promise.resolve()),
      commitTransaction:   jest.fn(() => Promise.resolve()),
      rollbackTransaction: jest.fn(() => Promise.resolve()),
    };
  });

  test('begin() calls connection.beginTransaction once', async () => {
    await Db2Transaction.prototype.begin.call(null, mockConnection);
    expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
  });

  test('commit() calls connection.commitTransaction and resolves with value', async () => {
    const result = await Db2Transaction.prototype.commit.call(null, mockConnection, 'result-value');
    expect(mockConnection.commitTransaction).toHaveBeenCalledTimes(1);
    expect(result).toBe('result-value');
  });

  test('rollback() calls connection.rollbackTransaction and resolves with original error', async () => {
    const originalError = new Error('original');
    const result = await Db2Transaction.prototype.rollback.call(null, mockConnection, originalError);
    expect(mockConnection.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(result).toBe(originalError);
  });

  test('rollback() resolves with original error even when rollbackTransaction fails', async () => {
    mockConnection.rollbackTransaction = jest.fn(() => Promise.reject(new Error('rollback failed')));
    const originalError = new Error('original');
    const result = await Db2Transaction.prototype.rollback.call(null, mockConnection, originalError);
    expect(result).toBe(originalError);
  });

  test('begin() rejects if beginTransaction returns error', async () => {
    mockConnection.beginTransaction = jest.fn(() => Promise.reject(new Error('begin failed')));
    await expect(Db2Transaction.prototype.begin.call(null, mockConnection)).rejects.toThrow('begin failed');
  });

  describe('setIsolationLevel', () => {
    test('does not call setIsolationLevel when not configured', async () => {
      mockConnection.setIsolationLevel = jest.fn();
      await Db2Transaction.prototype.begin.call(null, mockConnection);
      expect(mockConnection.setIsolationLevel).not.toHaveBeenCalled();
    });

    test('calls setIsolationLevel with numeric level from client config', async () => {
      mockConnection.setIsolationLevel = jest.fn();
      const ctx = { client: { config: { isolationLevel: 4 } } };
      await Db2Transaction.prototype.begin.call(ctx, mockConnection);
      expect(mockConnection.setIsolationLevel).toHaveBeenCalledWith(4);
      expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
    });

    test('calls setIsolationLevel with string constant SERIALIZABLE', async () => {
      mockConnection.setIsolationLevel = jest.fn();
      const ctx = { client: { config: { isolationLevel: 'SERIALIZABLE' } } };
      await Db2Transaction.prototype.begin.call(ctx, mockConnection);
      expect(mockConnection.setIsolationLevel).toHaveBeenCalledWith(8);
    });

    test('calls setIsolationLevel with READ_COMMITTED string', async () => {
      mockConnection.setIsolationLevel = jest.fn();
      const ctx = { client: { config: { isolationLevel: 'READ_COMMITTED' } } };
      await Db2Transaction.prototype.begin.call(ctx, mockConnection);
      expect(mockConnection.setIsolationLevel).toHaveBeenCalledWith(2);
    });

    test('does not throw if connection lacks setIsolationLevel method', async () => {
      const ctx = { client: { config: { isolationLevel: 2 } } };
      // mockConnection has no setIsolationLevel — should not throw
      await expect(Db2Transaction.prototype.begin.call(ctx, mockConnection)).resolves.toBeUndefined();
    });
  });
});