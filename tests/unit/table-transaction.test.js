'use strict';
const knex = require('knex');
const Db2Client = require('../../src/client');
const { Db2Transaction } = require('../../src/transaction');

let db;
beforeAll(() => {
  db = knex({ client: Db2Client, connection: {}, pool: { min: 0 } });
});
afterAll(async () => { await db.destroy(); });

describe('Db2TableCompiler', () => {
  const ddl    = (fn) => db.schema.createTable('users', fn).toSQL();
  const alter  = (fn) => db.schema.table('users', fn).toSQL();
  const joinSql = (stmts) => stmts.map((s) => s.sql || s).join(' ');

  test('primary() on createTable emits CREATE UNIQUE INDEX then ALTER TABLE ADD CONSTRAINT PRIMARY KEY', () => {
    const stmts = ddl((t) => {
      t.integer('id').notNullable().primary();
    });
    const sqls = stmts.map((s) => s.sql || s);
    const createIdx = sqls.find((s) => /CREATE UNIQUE INDEX/i.test(s));
    const addPk     = sqls.find((s) => /ADD CONSTRAINT.*PRIMARY KEY/i.test(s));
    expect(createIdx).toBeTruthy();
    expect(addPk).toBeTruthy();
    // Both should reference the id column
    expect(createIdx).toMatch(/\(id\)/i);
    expect(addPk).toMatch(/\(id\)/i);
    // CREATE TABLE itself should NOT contain 'primary key' inline
    const createTable = sqls.find((s) => /CREATE TABLE/i.test(s));
    expect(createTable).not.toMatch(/primary key/i);
  });

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

  test('createTableLike() emits CREATE TABLE AS (SELECT * FROM old) WITH NO DATA', () => {
    const stmts = db.schema.createTableLike('users_copy', 'users').toSQL();
    const sqls = stmts.map((s) => s.sql || s);
    const createTableAs = sqls.find((s) => /CREATE TABLE users_copy.*AS.*SELECT.*FROM users.*WITH NO DATA/i.test(s));
    expect(createTableAs).toBeTruthy();
  });

  test('createTable with tablespace option appends IN <tablespace>', () => {
    const stmts = ddl((t) => {
      t.integer('id');
      t.tablespace('TS_MAIN');
    });
    const sqls = stmts.map((s) => s.sql || s);
    const createTable = sqls.find((s) => /CREATE TABLE/i.test(s));
    expect(createTable).toMatch(/IN TS_MAIN$/i);
  });

  test('unique() emits CONSTRAINT during CREATE TABLE', () => {
    const stmts = ddl((t) => {
      t.integer('id');
      t.string('email').unique('idx_email_unique');
    });
    const sqls = stmts.map((s) => s.sql || s);
    const createTable = sqls.find((s) => /CREATE TABLE/i.test(s));
    expect(createTable).toMatch(/CONSTRAINT/i);
    expect(createTable).toMatch(/UNIQUE/i);
  });

  test('unique() via alter emits CREATE UNIQUE INDEX', () => {
    const sql = joinSql(alter((t) => {
      t.string('email').unique('idx_email_unique');
    }));
    expect(sql).toMatch(/CREATE UNIQUE INDEX idx_email_unique ON users/i);
  });

  test('dropUnique() emits DROP INDEX without ON table clause', () => {
    const sql = joinSql(alter((t) => t.dropUnique(['email'], 'idx_email_unique')));
    expect(sql).toMatch(/DROP INDEX idx_email_unique/i);
    expect(sql).not.toMatch(/ON users/i);
  });

  test('dropForeign() emits ALTER TABLE DROP FOREIGN KEY', () => {
    const sql = joinSql(alter((t) => t.dropForeign(['org_id'], 'fk_org')));
    expect(sql).toMatch(/ALTER TABLE users DROP FOREIGN KEY fk_org/i);
  });

  test('dropPrimary() emits ALTER TABLE DROP PRIMARY KEY', () => {
    const sql = joinSql(alter((t) => t.dropPrimary()));
    expect(sql).toMatch(/ALTER TABLE users DROP PRIMARY KEY/i);
  });

  test('alterColumns sets NOT NULL via .notNullable().alter()', () => {
    const stmts = alter((t) => {
      t.integer('age').notNullable().alter();
    });
    const sqls = stmts.map((s) => s.sql || s);
    const alterCol = sqls.find((s) => /ALTER COLUMN age.*SET NOT NULL/i.test(s));
    expect(alterCol).toBeTruthy();
  });

  test('alterColumns drops NOT NULL via .nullable().alter()', () => {
    const stmts = alter((t) => {
      t.integer('age').nullable().alter();
    });
    const sqls = stmts.map((s) => s.sql || s);
    const alterCol = sqls.find((s) => /ALTER COLUMN age.*DROP NOT NULL/i.test(s));
    expect(alterCol).toBeTruthy();
  });

  test('alterColumns sets DEFAULT via .defaultTo(val).alter()', () => {
    const stmts = alter((t) => {
      t.string('status').defaultTo('active').alter();
    });
    const sqls = stmts.map((s) => s.sql || s);
    const alterCol = sqls.find((s) => /ALTER COLUMN status.*SET DEFAULT 'active'/i.test(s));
    expect(alterCol).toBeTruthy();
  });

  test('alterColumns drops DEFAULT via .defaultTo(null).alter()', () => {
    const stmts = alter((t) => {
      t.integer('priority').defaultTo(null).alter();
    });
    const sqls = stmts.map((s) => s.sql || s);
    const alterCol = sqls.find((s) => /ALTER COLUMN priority.*DROP DEFAULT/i.test(s));
    expect(alterCol).toBeTruthy();
  });
});

describe('Db2Transaction', () => {
  let mockConnection;

  beforeEach(() => {
    mockConnection = {
      beginTransaction:    vi.fn(() => Promise.resolve()),
      commitTransaction:   vi.fn(() => Promise.resolve()),
      rollbackTransaction: vi.fn(() => Promise.resolve()),
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

    test('commit() with context that has _resolver calls it', async () => {
      const resolverSpy = vi.fn();
      const ctx = { _resolver: resolverSpy, _completed: false };
      const result = await Db2Transaction.prototype.commit.call(ctx, mockConnection, 'my-value');
      expect(mockConnection.commitTransaction).toHaveBeenCalledTimes(1);
      expect(resolverSpy).toHaveBeenCalledWith('my-value');
      expect(ctx._completed).toBe(true);
      expect(result).toBe('my-value');
    });

  test('rollback() calls connection.rollbackTransaction and resolves with original error', async () => {
    const originalError = new Error('original');
    const result = await Db2Transaction.prototype.rollback.call(null, mockConnection, originalError);
    expect(mockConnection.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(result).toBe(originalError);
  });

  test('rollback() resolves with original error even when rollbackTransaction fails', async () => {
    mockConnection.rollbackTransaction = vi.fn(() => Promise.reject(new Error('rollback failed')));
    const originalError = new Error('original');
    const result = await Db2Transaction.prototype.rollback.call(null, mockConnection, originalError);
    expect(result).toBe(originalError);
  });

    test('rollback() with context that has _rejecter calls it on error', async () => {
      const rejecterSpy = vi.fn();
      const ctx = { _resolver: vi.fn(), _rejecter: rejecterSpy, _completed: false };
      const testError = new Error('test-error');
      const result = await Db2Transaction.prototype.rollback.call(ctx, mockConnection, testError);
      expect(rejecterSpy).toHaveBeenCalledWith(testError);
      expect(ctx._completed).toBe(true);
      expect(result).toBe(testError);
    });

    test('rollback() with context calls _resolver when doNotRejectOnRollback is true', async () => {
      const resolverSpy = vi.fn();
      const rejecterSpy = vi.fn();
      const ctx = { _resolver: resolverSpy, _rejecter: rejecterSpy, _completed: false, doNotRejectOnRollback: true };
      const result = await Db2Transaction.prototype.rollback.call(ctx, mockConnection, null);
      expect(resolverSpy).toHaveBeenCalled();
      expect(rejecterSpy).not.toHaveBeenCalled();
      expect(ctx._completed).toBe(true);
      expect(result).toBeNull();
    });

    test('rollback() with context calls _rejecter with default error when no error passed', async () => {
      const rejecterSpy = vi.fn();
      const ctx = { _resolver: vi.fn(), _rejecter: rejecterSpy, _completed: false };
      const result = await Db2Transaction.prototype.rollback.call(ctx, mockConnection, undefined);
      expect(rejecterSpy).toHaveBeenCalled();
      const errorArg = rejecterSpy.mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(Error);
      expect(errorArg.message).toContain('Transaction rejected');
    });

  test('begin() rejects if beginTransaction returns error', async () => {
    mockConnection.beginTransaction = vi.fn(() => Promise.reject(new Error('begin failed')));
    await expect(Db2Transaction.prototype.begin.call(null, mockConnection)).rejects.toThrow('begin failed');
  });

  describe('setIsolationLevel', () => {
    test('does not call setIsolationLevel when not configured', async () => {
      mockConnection.setIsolationLevel = vi.fn();
      await Db2Transaction.prototype.begin.call(null, mockConnection);
      expect(mockConnection.setIsolationLevel).not.toHaveBeenCalled();
    });

    test('calls setIsolationLevel with numeric level from client config', async () => {
      mockConnection.setIsolationLevel = vi.fn();
      const ctx = { client: { config: { isolationLevel: 4 } } };
      await Db2Transaction.prototype.begin.call(ctx, mockConnection);
      expect(mockConnection.setIsolationLevel).toHaveBeenCalledWith(4);
      expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
    });

    test('calls setIsolationLevel with string constant SERIALIZABLE', async () => {
      mockConnection.setIsolationLevel = vi.fn();
      const ctx = { client: { config: { isolationLevel: 'SERIALIZABLE' } } };
      await Db2Transaction.prototype.begin.call(ctx, mockConnection);
      expect(mockConnection.setIsolationLevel).toHaveBeenCalledWith(8);
    });

    test('calls setIsolationLevel with READ_COMMITTED string', async () => {
      mockConnection.setIsolationLevel = vi.fn();
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

  describe('Savepoint methods', () => {
    test('savepoint() calls this.query with SAVEPOINT <txid> ON ROLLBACK RETAIN CURSORS', async () => {
      const querySpy = vi.fn(() => Promise.resolve());
      const ctx = { txid: 'tx_sp1', query: querySpy };
      await Db2Transaction.prototype.savepoint.call(ctx, mockConnection);
      expect(querySpy).toHaveBeenCalledTimes(1);
      const [conn, sql] = querySpy.mock.calls[0];
      expect(sql).toBe('SAVEPOINT tx_sp1 ON ROLLBACK RETAIN CURSORS');
    });

    test('release() calls this.query with RELEASE SAVEPOINT <txid>', async () => {
      const querySpy = vi.fn(() => Promise.resolve());
      const ctx = { txid: 'tx_sp1', query: querySpy };
      const testValue = { inserted: 1 };
      await Db2Transaction.prototype.release.call(ctx, mockConnection, testValue);
      expect(querySpy).toHaveBeenCalledTimes(1);
      const [conn, sql, level, value] = querySpy.mock.calls[0];
      expect(sql).toBe('RELEASE SAVEPOINT tx_sp1');
      expect(level).toBe(1);
      expect(value).toBe(testValue);
    });

    test('rollbackTo() calls this.query with ROLLBACK TO SAVEPOINT <txid>', async () => {
      const querySpy = vi.fn(() => Promise.resolve());
      const ctx = { txid: 'tx_sp1', query: querySpy };
      const testError = new Error('rollback test');
      await Db2Transaction.prototype.rollbackTo.call(ctx, mockConnection, testError);
      expect(querySpy).toHaveBeenCalledTimes(1);
      const [conn, sql, level, error] = querySpy.mock.calls[0];
      expect(sql).toBe('ROLLBACK TO SAVEPOINT tx_sp1');
      expect(level).toBe(2);
      expect(error).toBe(testError);
    });

    test('savepoint() with different txid values emits correct SQL', async () => {
      const querySpy = vi.fn(() => Promise.resolve());
      const ctx = { txid: 'tx_test_123', query: querySpy };
      await Db2Transaction.prototype.savepoint.call(ctx, mockConnection);
      expect(querySpy).toHaveBeenCalledWith(mockConnection, 'SAVEPOINT tx_test_123 ON ROLLBACK RETAIN CURSORS');
    });
  });
});