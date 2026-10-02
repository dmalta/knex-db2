'use strict';
// Unit tests for the `connection.autocommit` setting (default: true).
// No real DB2: ibm_db connections are replaced with in-memory fakes.
const knex = require('knex');
const Db2Client = require('../../src/client');
const { Db2Transaction } = require('../../src/transaction');
const { SQL_ATTR_AUTOCOMMIT, SQL_AUTOCOMMIT_ON, autocommitEnabled } = require('../../src/autocommit');

// A fake ibm_db connection that tracks its autocommit state the way ODBC does:
// beginTransaction turns it off; only setAttr(SQL_ATTR_AUTOCOMMIT, 1) turns it
// back on (commit/rollback here deliberately do not, so the driver's own restore
// is what the tests observe).
function fakeConnection({ initialAutocommit = true } = {}) {
  const calls = [];
  const conn = {
    autocommit: initialAutocommit,
    calls,
    connected: true,
    setAttr: vi.fn(async (attr, value) => {
      calls.push(['setAttr', attr, value]);
      if (attr === SQL_ATTR_AUTOCOMMIT) conn.autocommit = value === SQL_AUTOCOMMIT_ON;
      return true;
    }),
    beginTransaction: vi.fn(async () => {
      calls.push(['beginTransaction']);
      conn.autocommit = false;
    }),
    commitTransaction: vi.fn(async () => {
      calls.push(['commitTransaction']);
    }),
    rollbackTransaction: vi.fn(async () => {
      calls.push(['rollbackTransaction']);
    }),
    prepare: vi.fn(async (sql) => {
      calls.push(['prepare', sql, conn.autocommit]);
      return {
        execute: async () => ({ fetchAllSync: () => [{ ONE: 1 }], closeSync: () => {} }),
        executeNonQuery: async () => 1,
        closeSync: () => {},
      };
    }),
    query: vi.fn((sql, params, cb) => cb(null, [{ IBMREQD: 'Y' }])),
    close: vi.fn((cb) => cb(null)),
  };
  return conn;
}

describe('autocommitEnabled()', () => {
  test('defaults to true when the setting is absent', () => {
    expect(autocommitEnabled({})).toBe(true);
    expect(autocommitEnabled(undefined)).toBe(true);
    expect(autocommitEnabled({ autocommit: true })).toBe(true);
  });

  test('is false only when explicitly set to false', () => {
    expect(autocommitEnabled({ autocommit: false })).toBe(false);
  });
});

describe('Db2Client autocommit on new connections', () => {
  let originalOpen;
  let client;

  beforeEach(() => {
    client = new Db2Client({ client: 'db2', connection: {} });
    originalOpen = client.driver.open;
  });

  afterEach(() => {
    client.driver.open = originalOpen;
  });

  test('setConnectionOptions() turns autocommit on by default', async () => {
    const conn = fakeConnection({ initialAutocommit: false });
    await client.setConnectionOptions(conn);
    expect(conn.setAttr).toHaveBeenCalledWith(SQL_ATTR_AUTOCOMMIT, SQL_AUTOCOMMIT_ON);
    expect(conn.autocommit).toBe(true);
    expect(conn.__knex__autocommit).toBe(true);
  });

  test('setConnectionOptions() leaves the connection alone with autocommit: false', async () => {
    const optedOut = new Db2Client({ client: 'db2', connection: { autocommit: false } });
    const conn = fakeConnection({ initialAutocommit: false });
    await optedOut.setConnectionOptions(conn);
    expect(conn.setAttr).not.toHaveBeenCalled();
    expect(conn.autocommit).toBe(false);
    expect(conn.__knex__autocommit).toBe(false);
  });

  test('acquireRawConnection() turns autocommit on before resolving', async () => {
    const conn = fakeConnection({ initialAutocommit: false });
    client.driver.open = vi.fn((_connStr, cb) => setTimeout(() => cb(null, conn), 0));

    const acquired = await client.acquireRawConnection();

    expect(acquired).toBe(conn);
    expect(conn.setAttr).toHaveBeenCalledWith(SQL_ATTR_AUTOCOMMIT, SQL_AUTOCOMMIT_ON);
    expect(conn.autocommit).toBe(true);
  });

  test('acquireRawConnection() closes the connection and rejects if autocommit cannot be set', async () => {
    const conn = fakeConnection();
    conn.setAttr = vi.fn(async () => {
      throw new Error('setAttr failed');
    });
    client.driver.open = vi.fn((_connStr, cb) => setTimeout(() => cb(null, conn), 0));

    await expect(client.acquireRawConnection()).rejects.toBeDefined();
    expect(conn.close).toHaveBeenCalledTimes(1);
  });
});

describe('Db2Transaction restores autocommit', () => {
  test('commit() turns autocommit back on after committing', async () => {
    const conn = fakeConnection();
    conn.__knex__autocommit = true;
    await Db2Transaction.prototype.begin.call(null, conn);
    expect(conn.autocommit).toBe(false);

    await Db2Transaction.prototype.commit.call(null, conn, 'v');

    expect(conn.calls.map((c) => c[0])).toEqual(['beginTransaction', 'commitTransaction', 'setAttr']);
    expect(conn.autocommit).toBe(true);
  });

  test('rollback() turns autocommit back on after rolling back', async () => {
    const conn = fakeConnection();
    conn.__knex__autocommit = true;
    await Db2Transaction.prototype.begin.call(null, conn);
    await Db2Transaction.prototype.rollback.call(null, conn, new Error('boom'));

    expect(conn.calls.map((c) => c[0])).toEqual(['beginTransaction', 'rollbackTransaction', 'setAttr']);
    expect(conn.autocommit).toBe(true);
  });

  test('rollback() still restores autocommit when rollbackTransaction fails', async () => {
    const conn = fakeConnection();
    conn.rollbackTransaction = vi.fn(async () => {
      throw new Error('rollback failed');
    });
    await Db2Transaction.prototype.begin.call(null, conn);
    await Db2Transaction.prototype.rollback.call(null, conn, new Error('boom'));
    expect(conn.autocommit).toBe(true);
  });

  test('commit() restores autocommit even when commitTransaction fails', async () => {
    const conn = fakeConnection();
    conn.commitTransaction = vi.fn(async () => {
      throw new Error('commit failed');
    });
    await Db2Transaction.prototype.begin.call(null, conn);
    await expect(Db2Transaction.prototype.commit.call(null, conn, 'v')).rejects.toThrow('commit failed');
    expect(conn.autocommit).toBe(true);
  });

  test('begin() restores autocommit when beginTransaction fails', async () => {
    const conn = fakeConnection();
    conn.beginTransaction = vi.fn(async () => {
      conn.autocommit = false;
      throw new Error('begin failed');
    });
    await expect(Db2Transaction.prototype.begin.call(null, conn)).rejects.toThrow('begin failed');
    expect(conn.autocommit).toBe(true);
  });

  test('a connection whose autocommit cannot be restored is marked disposed', async () => {
    const conn = fakeConnection();
    conn.setAttr = vi.fn(async () => {
      throw new Error('setAttr failed');
    });
    await Db2Transaction.prototype.begin.call(null, conn);
    await Db2Transaction.prototype.commit.call(null, conn, 'v');
    expect(conn.__knex__disposed).toBe(true);
  });

  test('with autocommit: false, commit/rollback do not touch autocommit', async () => {
    const conn = fakeConnection();
    conn.__knex__autocommit = false;
    await Db2Transaction.prototype.begin.call(null, conn);
    await Db2Transaction.prototype.commit.call(null, conn, 'v');
    await Db2Transaction.prototype.begin.call(null, conn);
    await Db2Transaction.prototype.rollback.call(null, conn, new Error('boom'));
    expect(conn.setAttr).not.toHaveBeenCalled();
    expect(conn.autocommit).toBe(false);
  });
});

describe('Knex pool + transactions (fake driver)', () => {
  let originalOpen;
  let opened;
  let db;

  function makeDb(connection) {
    db = knex({ client: Db2Client, connection, pool: { min: 0, max: 1 } });
    originalOpen = db.client.driver.open;
    opened = [];
    db.client.driver.open = vi.fn((_connStr, cb) => {
      // Simulate a CLI configuration that opens connections in manual-commit mode.
      const conn = fakeConnection({ initialAutocommit: false });
      opened.push(conn);
      setTimeout(() => cb(null, conn), 0);
    });
    return db;
  }

  afterEach(async () => {
    if (db) {
      db.client.driver.open = originalOpen;
      await db.destroy();
      db = null;
    }
  });

  test('by default, statements outside a transaction run with autocommit on', async () => {
    makeDb({});
    await db.raw('SELECT 1 AS ONE FROM SYSIBM.SYSDUMMY1');
    expect(opened).toHaveLength(1);
    const prepares = opened[0].calls.filter((c) => c[0] === 'prepare');
    expect(prepares.at(-1)[2]).toBe(true);
  });

  test('a committed transaction runs with autocommit off and hands back an autocommit connection', async () => {
    makeDb({});
    await db.transaction(async (trx) => {
      await trx.raw('SELECT 1 AS ONE FROM SYSIBM.SYSDUMMY1');
    });
    await db.raw('SELECT 2 AS TWO FROM SYSIBM.SYSDUMMY1');

    expect(opened).toHaveLength(1); // same pooled connection reused
    const conn = opened[0];
    const prepares = conn.calls.filter((c) => c[0] === 'prepare');
    expect(prepares[0][2]).toBe(false); // inside the transaction
    expect(prepares[1][2]).toBe(true); // after it, back in the pool
    expect(conn.autocommit).toBe(true);
  });

  test('a rolled-back transaction hands back an autocommit connection', async () => {
    makeDb({});
    await expect(
      db.transaction(async (trx) => {
        await trx.raw('SELECT 1 AS ONE FROM SYSIBM.SYSDUMMY1');
        throw new Error('abort');
      })
    ).rejects.toThrow('abort');
    await db.raw('SELECT 2 AS TWO FROM SYSIBM.SYSDUMMY1');

    const conn = opened[0];
    expect(conn.calls.map((c) => c[0])).toContain('rollbackTransaction');
    expect(conn.calls.filter((c) => c[0] === 'prepare').at(-1)[2]).toBe(true);
  });

  test('with autocommit: false the driver does not change the connection', async () => {
    makeDb({ autocommit: false });
    await db.transaction(async (trx) => {
      await trx.raw('SELECT 1 AS ONE FROM SYSIBM.SYSDUMMY1');
    });
    await db.raw('SELECT 2 AS TWO FROM SYSIBM.SYSDUMMY1');

    const conn = opened[0];
    expect(conn.setAttr).not.toHaveBeenCalled();
    expect(conn.autocommit).toBe(false);
  });
});
