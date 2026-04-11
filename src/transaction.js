'use strict';
const Transaction = require('knex/lib/execution/transaction');

// DB2 isolation level constants (maps to ODBC SQL_TXN_* values)
const ISOLATION_LEVELS = {
  'READ_UNCOMMITTED': 1,
  'READ UNCOMMITTED': 1,
  'READ_COMMITTED':   2,
  'READ COMMITTED':   2,
  'REPEATABLE_READ':  4,
  'REPEATABLE READ':  4,
  'SERIALIZABLE':     8,
};

class Db2Transaction extends Transaction {
  async begin(connection) {
    // Set isolation level before beginning the transaction if configured.
    // Accepts numeric ODBC level (1/2/4/8) or a string constant.
    const isolationLevel = this?.client?.config?.isolationLevel
      ?? this?.outerTx?.client?.config?.isolationLevel;

    if (isolationLevel !== undefined) {
      const numericLevel = typeof isolationLevel === 'string'
        ? ISOLATION_LEVELS[isolationLevel.toUpperCase().replace(/-/g, '_')]
        : isolationLevel;

      if (numericLevel !== undefined && typeof connection.setIsolationLevel === 'function') {
        connection.setIsolationLevel(numericLevel);
      }
    }

    await connection.beginTransaction();
  }

  async commit(connection, value) {
    await connection.commitTransaction();
    return value;
  }

  async rollback(connection, error) {
    try {
      await connection.rollbackTransaction();
    } catch {
      // Resolve even on rollback error — propagate original error to caller.
    }
    return error;
  }

  // Savepoints via SQL — ibm_db does not expose savepoint-level APIs.
  // DB2 z/OS supports SAVEPOINTs from V8 (SQL syntax, not driver API).
  savepoint(connection) {
    return this.query(connection, `SAVEPOINT ${this.txid} ON ROLLBACK RETAIN CURSORS`);
  }

  release(connection, value) {
    return this.query(connection, `RELEASE SAVEPOINT ${this.txid}`, 1, value);
  }

  rollbackTo(connection, error) {
    return this.query(connection, `ROLLBACK TO SAVEPOINT ${this.txid}`, 2, error);
  }
}

module.exports = { Db2Transaction };