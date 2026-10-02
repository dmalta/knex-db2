'use strict';

// ODBC connection attribute and value (sqlext.h) for autocommit.
const SQL_ATTR_AUTOCOMMIT = 102;
const SQL_AUTOCOMMIT_ON = 1;

// Whether a connection config asks for autocommit (default: true).
function autocommitEnabled(connectionSettings) {
  return connectionSettings?.autocommit !== false;
}

// Turn autocommit on for an ibm_db connection. Connections without setAttr
// (older drivers, test doubles) are left as they are.
async function enableAutocommit(connection) {
  if (!connection || typeof connection.setAttr !== 'function') return;
  await connection.setAttr(SQL_ATTR_AUTOCOMMIT, SQL_AUTOCOMMIT_ON);
}

// Put autocommit back on after a transaction ends, before the connection
// returns to the pool. A connection left in manual-commit mode would hold its
// unit of work (and its locks) open after every later statement, so if the
// restore fails the connection is marked disposed and the pool discards it.
async function restoreAutocommit(connection) {
  if (!connection || connection.__knex__autocommit === false) return;
  try {
    await enableAutocommit(connection);
  } catch {
    connection.__knex__disposed = true;
  }
}

module.exports = {
  SQL_ATTR_AUTOCOMMIT,
  SQL_AUTOCOMMIT_ON,
  autocommitEnabled,
  enableAutocommit,
  restoreAutocommit,
};
