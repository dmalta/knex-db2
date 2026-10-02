'use strict';
const Transaction = require('knex/lib/execution/transaction');
const { restoreAutocommit } = require('./autocommit');

// DB2 isolation level constants (maps to ODBC SQL_TXN_* values)
const ISOLATION_LEVELS = {
  READ_UNCOMMITTED: 1,
  'READ UNCOMMITTED': 1,
  READ_COMMITTED: 2,
  'READ COMMITTED': 2,
  REPEATABLE_READ: 4,
  'REPEATABLE READ': 4,
  SERIALIZABLE: 8,
};

class Db2Transaction extends Transaction {
  async begin(connection) {
    // Set isolation level before beginning the transaction if configured.
    // Accepts numeric ODBC level (1/2/4/8) or a string constant.
    const isolationLevel = this?.client?.config?.isolationLevel ?? this?.outerTx?.client?.config?.isolationLevel;

    if (isolationLevel !== undefined) {
      const numericLevel =
        typeof isolationLevel === 'string'
          ? ISOLATION_LEVELS[isolationLevel.toUpperCase().replace(/-/g, '_')]
          : isolationLevel;

      if (numericLevel !== undefined && typeof connection.setIsolationLevel === 'function') {
        connection.setIsolationLevel(numericLevel);
      }
    }

    try {
      await connection.beginTransaction();
    } catch (err) {
      // Knex releases the connection without calling commit/rollback when begin
      // fails, so make sure it does not go back to the pool with autocommit off.
      await restoreAutocommit(connection);
      throw err;
    }
  }

  // ibm_db's beginTransaction turns autocommit off on the connection; commit and
  // rollback put it back on (when autocommit is enabled) before Knex releases the
  // connection to the pool.
  async commit(connection, value) {
    try {
      await connection.commitTransaction();
    } finally {
      await restoreAutocommit(connection);
    }
    // _resolver is set by Knex's Transaction base class during _evaluateContainer.
    // Guard for unit-test contexts where `this` may be null or incomplete.
    if (this && typeof this._resolver === 'function') {
      this._completed = true;
      this._resolver(value);
    }
    return value;
  }

  async rollback(connection, error) {
    try {
      await connection.rollbackTransaction();
    } catch {
      // Resolve even on rollback error — propagate original error to caller.
    }
    await restoreAutocommit(connection);
    if (this && typeof this._resolver === 'function') {
      this._completed = true;
      if (error !== undefined && error !== null) {
        this._rejecter(error);
      } else if (this.doNotRejectOnRollback) {
        this._resolver();
      } else {
        this._rejecter(new Error('Transaction rejected with non-error: undefined'));
      }
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
