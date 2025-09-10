/**
 * DB2 Error Code Mapping and Enhanced Error Handling
 *
 * This module provides comprehensive error code mapping for IBM DB2 for z/OS
 * and enhanced error handling functionality for the Knex.js DB2 client.
 */

/**
 * Comprehensive DB2 error code mapping
 * Maps DB2 SQLCODE values to human-readable error types
 */

const DB2_ERROR_MAP = {
  // Connection errors
  '-30081': 'CONNECTION_FAILED',
  '-1024': 'DATABASE_NOT_FOUND',
  '-1336': 'HOST_NOT_FOUND',
  '-30080': 'COMMUNICATION_ERROR',
  '-30090': 'SECURITY_ERROR',

  // Authentication and Authorization errors
  '-1403': 'INVALID_CREDENTIALS',
  '-551': 'INSUFFICIENT_PRIVILEGES',
  '-552': 'AUTHORIZATION_FAILURE',
  '-553': 'AUTHORIZATION_NAME_INVALID',
  '-554': 'CANNOT_GRANT_PRIVILEGE',
  '-555': 'CANNOT_REVOKE_PRIVILEGE',
  '-556': 'REVOKE_NOT_AUTHORIZED',
  '-557': 'PRIVILEGE_NOT_GRANTED',
  '-558': 'INVALID_AUTHORIZATION',
  '-562': 'GRANT_NOT_ALLOWED',
  '-567': 'BIND_AUTHORIZATION_FAILURE',
  '-922': 'AUTHORIZATION_REQUIRED',
  '-30082': 'AUTHENTICATION_FAILED',

  // Common SQL syntax errors
  '-101': 'STATEMENT_TOO_LONG',
  '-102': 'STRING_CONSTANT_TOO_LONG',
  '-103': 'INVALID_NUMERIC_LITERAL',
  '-104': 'SYNTAX_ERROR', // Invalid token
  '-105': 'INVALID_STRING_CONSTANT',
  '-107': 'OBJECT_NAME_TOO_LONG',
  '-108': 'INVALID_NAME',
  '-109': 'CLAUSE_NOT_PERMITTED',
  '-110': 'INVALID_HEXADECIMAL_CONSTANT',
  '-111': 'INVALID_COLUMN_FUNCTION',
  '-112': 'OPERAND_NOT_COLUMN_FUNCTION',
  '-113': 'INVALID_CHARACTER',
  '-114': 'CURSOR_NOT_POSITIONED',
  '-115': 'PREDICATE_NOT_VALID',
  '-117': 'WRONG_NUMBER_OF_VALUES',
  '-118': 'ROW_NOT_IN_TABLE',
  '-119': 'COLUMN_LIST_NOT_VALID',
  '-120': 'WHERE_NOT_ALLOWED',
  '-121': 'COLUMN_NOT_UPDATABLE',
  '-122': 'SELECT_NOT_VALID',
  '-125': 'ORDER_BY_NOT_VALID',
  '-199': 'SYNTAX_ERROR',

  // Object/schema errors
  '-203': 'AMBIGUOUS_COLUMN_REFERENCE',
  '-204': 'OBJECT_NOT_FOUND', // Table, view, or alias not found
  '-205': 'COLUMN_NOT_FOUND_IN_TABLE',
  '-206': 'COLUMN_NOT_FOUND',
  '-208': 'ORDER_BY_COLUMN_NOT_SELECTED',

  // Data type and constraint errors
  '-301': 'INPUT_VALUE_TOO_LONG',
  '-302': 'CONVERSION_ERROR',
  '-407': 'NULL_VALUE_NOT_ALLOWED',
  '-408': 'INVALID_DATA_TYPE',
  '-413': 'OVERFLOW_ERROR',
  '-420': 'CHARACTER_CONVERSION_ERROR',

  // Constraint violations
  '-530': 'FOREIGN_KEY_VIOLATION',
  '-531': 'PARENT_KEY_IN_CHILD_TABLE',
  '-532': 'DELETE_RESTRICT_VIOLATION',
  '-803': 'DUPLICATE_KEY',

  // Cursor and result set errors
  '-811': 'MORE_THAN_ONE_ROW',
  '-818': 'TIMESTAMP_CONFLICT',

  // Transaction and locking errors
  '-902': 'BIND_ERROR',
  '-904': 'RESOURCE_UNAVAILABLE', // Unsuccessful execution
  '-909': 'OBJECT_DELETED',
  '-910': 'OBJECT_DROPPED',
  '-911': 'LOCK_TIMEOUT', // Deadlock or timeout
  '-913': 'DEADLOCK_DETECTED', // Deadlock detected
  '-924': 'CONNECTION_ALREADY_EXISTS',

  // Resource and storage errors
  '-289': 'TABLESPACE_FULL',
  '-971': 'TABLESPACE_NOT_AVAILABLE',
};

/**
 * Error categories for grouping related error types
 */
const ERROR_CATEGORIES = {
  CONNECTION: ['CONNECTION_FAILED', 'HOST_NOT_FOUND', 'COMMUNICATION_ERROR', 'DATABASE_NOT_FOUND'],
  AUTHENTICATION: ['AUTHENTICATION_FAILED', 'INVALID_CREDENTIALS'],
  AUTHORIZATION: [
    'INSUFFICIENT_PRIVILEGES', 'AUTHORIZATION_FAILURE', 'AUTHORIZATION_NAME_INVALID',
    'CANNOT_GRANT_PRIVILEGE', 'CANNOT_REVOKE_PRIVILEGE', 'REVOKE_NOT_AUTHORIZED',
    'PRIVILEGE_NOT_GRANTED', 'INVALID_AUTHORIZATION', 'GRANT_NOT_ALLOWED',
    'BIND_AUTHORIZATION_FAILURE', 'AUTHORIZATION_REQUIRED'
  ],
  SYNTAX: [
    'SYNTAX_ERROR', 'STATEMENT_TOO_LONG', 'STRING_CONSTANT_TOO_LONG',
    'INVALID_NUMERIC_LITERAL', 'INVALID_STRING_CONSTANT', 'OBJECT_NAME_TOO_LONG',
    'INVALID_NAME', 'CLAUSE_NOT_PERMITTED', 'INVALID_HEXADECIMAL_CONSTANT',
    'INVALID_COLUMN_FUNCTION', 'OPERAND_NOT_COLUMN_FUNCTION', 'INVALID_CHARACTER',
    'PREDICATE_NOT_VALID', 'WRONG_NUMBER_OF_VALUES', 'ORDER_BY_NOT_VALID'
  ],
  SCHEMA: [
    'OBJECT_NOT_FOUND', 'COLUMN_NOT_FOUND', 'AMBIGUOUS_COLUMN_REFERENCE',
    'COLUMN_NOT_FOUND_IN_TABLE', 'ORDER_BY_COLUMN_NOT_SELECTED'
  ],
  DATA: [
    'INPUT_VALUE_TOO_LONG', 'CONVERSION_ERROR', 'NULL_VALUE_NOT_ALLOWED',
    'INVALID_DATA_TYPE', 'OVERFLOW_ERROR', 'CHARACTER_CONVERSION_ERROR'
  ],
  CONSTRAINT: [
    'FOREIGN_KEY_VIOLATION', 'PARENT_KEY_IN_CHILD_TABLE', 'DELETE_RESTRICT_VIOLATION',
    'DUPLICATE_KEY'
  ],
  TRANSACTION: [
    'LOCK_TIMEOUT', 'DEADLOCK_DETECTED', 'BIND_ERROR', 'OBJECT_DELETED',
    'OBJECT_DROPPED'
  ],
  RESOURCE: [
    'RESOURCE_UNAVAILABLE', 'TABLESPACE_FULL', 'TABLESPACE_NOT_AVAILABLE'
  ]
};

/**
 * Enhanced DB2 Error class
 */
class DB2Error extends Error {
  constructor(originalError, sql = null, bindings = null) {
    super(originalError.message);
    
    this.name = 'DB2Error';
    this.sqlCode = originalError.sqlcode || originalError.code;
    this.sqlState = originalError.state || originalError.sqlstate;
    this.errorType = getErrorType(this.sqlCode);
    this.errorCategory = getErrorCategory(this.errorType);
    this.originalError = originalError;
    this.sql = sql;
    this.bindings = bindings;
    this.timestamp = new Date().toISOString();

    // Preserve stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DB2Error);
    }
  }

  /**
   * Check if error is of a specific type or category
   */
  isType(type) {
    return this.errorType === type;
  }

  isCategory(category) {
    return this.errorCategory === category;
  }

  /**
   * Check if error is retryable (connection/resource issues)
   */
  isRetryable() {
    const retryableCategories = ['CONNECTION', 'RESOURCE', 'TRANSACTION'];
    const retryableTypes = ['LOCK_TIMEOUT', 'DEADLOCK_DETECTED', 'RESOURCE_UNAVAILABLE'];

    return retryableCategories.includes(this.errorCategory) ||
           retryableTypes.includes(this.errorType);
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage() {
    const messages = {
      'CONNECTION_FAILED': 'Unable to connect to the database. Please check your connection settings.',
      'AUTHENTICATION_FAILED': 'Invalid username or password. Please check your credentials.',
      'INSUFFICIENT_PRIVILEGES': 'You do not have permission to perform this operation.',
      'OBJECT_NOT_FOUND': 'The requested table, view, or object was not found.',
      'COLUMN_NOT_FOUND': 'The specified column does not exist.',
      'SYNTAX_ERROR': 'There is a syntax error in your SQL statement.',
      'DUPLICATE_KEY': 'A record with this key already exists.',
      'FOREIGN_KEY_VIOLATION': 'This operation violates a foreign key constraint.',
      'NULL_VALUE_NOT_ALLOWED': 'A required field cannot be empty.',
      'DEADLOCK_DETECTED': 'A deadlock was detected. Please try again.',
      'LOCK_TIMEOUT': 'The operation timed out waiting for a lock. Please try again.',
      'RESOURCE_UNAVAILABLE': 'System resources are currently unavailable. Please try again later.',
    };

    return messages[this.errorType] || this.message;
  }

  /**
   * Convert to JSON for logging
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      sqlCode: this.sqlCode,
      sqlState: this.sqlState,
      errorType: this.errorType,
      errorCategory: this.errorCategory,
      sql: this.sql,
      bindings: this.bindings,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

/**
 * Get error type from SQL code
 */
function getErrorType(sqlCode) {
  return DB2_ERROR_MAP[String(sqlCode)] || 'UNKNOWN_ERROR';
}

/**
 * Get error category from error type
 */
function getErrorCategory(errorType) {
  for (const [category, types] of Object.entries(ERROR_CATEGORIES)) {
    if (types.includes(errorType)) {
      return category;
    }
  }
  return 'UNKNOWN';
}

/**
 * Enhanced error handler function
 */
function handleDB2Error(error, sql = null, bindings = null) {
  // If it's not a DB2 error (no sqlcode), return as-is
  if (!error.sqlcode && !error.code && !error.state && !error.sqlstate) {
    return error;
  }

  // Create enhanced DB2 error
  return new DB2Error(error, sql, bindings);
}

/**
 * Check if an error is a specific DB2 error code
 */
function isDB2ErrorCode(error, sqlCode) {
  if (!error || typeof error !== 'object') return false;
  const errorSqlCode = error.sqlCode || error.sqlcode || error.code;
  return String(errorSqlCode) === String(sqlCode);
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error) {
  if (error instanceof DB2Error) {
    return error.isRetryable();
  }
  
  const sqlCode = error.sqlCode || error.sqlcode || error.code;
  const errorType = getErrorType(sqlCode);
  const errorCategory = getErrorCategory(errorType);
  
  const retryableCategories = ['CONNECTION', 'RESOURCE', 'TRANSACTION'];
  const retryableTypes = ['LOCK_TIMEOUT', 'DEADLOCK_DETECTED', 'RESOURCE_UNAVAILABLE'];
  
  return retryableCategories.includes(errorCategory) || retryableTypes.includes(errorType);
}

module.exports = {
  DB2_ERROR_MAP,
  ERROR_CATEGORIES,
  DB2Error,
  handleDB2Error,
  getErrorType,
  getErrorCategory,
  isDB2ErrorCode,
  isRetryableError
};
