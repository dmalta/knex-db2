'use strict';
const Transaction = require('knex/lib/execution/transaction');

class Db2Transaction extends Transaction {
  begin(connection) {
    return new Promise((resolve, reject) => {
      connection.beginTransaction((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  commit(connection, value) {
    return new Promise((resolve, reject) => {
      connection.commitTransaction((err) => {
        if (err) return reject(err);
        resolve(value);
      });
    });
  }

  rollback(connection, error) {
    return new Promise((resolve) => {
      connection.rollbackTransaction(() => {
        // Resolve even on rollback error — propagate original error to caller.
        resolve(error);
      });
    });
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