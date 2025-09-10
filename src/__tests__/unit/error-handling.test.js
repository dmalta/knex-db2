// Unit tests for DB2 error handling and mapping
const Db2Client = require('../../client');

describe('DB2 Error Handling Unit Tests', () => {
  let client;

  beforeEach(() => {
    client = new Db2Client({ client: 'db2', connection: {} });
  });

  describe('Error Map', () => {
    test('should have comprehensive error mappings', () => {
      const errorMap = client.getErrorMap();

      // Connection errors
      expect(errorMap['-30081']).toBe('CONNECTION_FAILED');
      expect(errorMap['-30082']).toBe('AUTHENTICATION_FAILED');
      expect(errorMap['-1024']).toBe('DATABASE_NOT_FOUND');

      // SQL syntax errors
      expect(errorMap['-104']).toBe('SYNTAX_ERROR');
      expect(errorMap['-206']).toBe('COLUMN_NOT_FOUND');
      expect(errorMap['-204']).toBe('OBJECT_NOT_FOUND');

      // Data integrity errors
      expect(errorMap['-803']).toBe('DUPLICATE_KEY');
      expect(errorMap['-530']).toBe('FOREIGN_KEY_VIOLATION');
      expect(errorMap['-407']).toBe('NULL_VALUE_NOT_ALLOWED');

      // Transaction and locking errors
      expect(errorMap['-913']).toBe('DEADLOCK_DETECTED');
      expect(errorMap['-911']).toBe('LOCK_TIMEOUT');

      // Resource errors
      expect(errorMap['-289']).toBe('TABLESPACE_FULL');
      expect(errorMap['-551']).toBe('INSUFFICIENT_PRIVILEGES');
    });

    test('should handle unknown error codes', () => {
      const errorMap = client.getErrorMap();
      expect(errorMap['-99999']).toBeUndefined();
    });
  });

  describe('Error Enhancement', () => {
    test('should enhance DB2 errors with metadata', () => {
      const originalError = {
        message: 'SQL0204N TEST.NONEXISTENT is an undefined name. SQLSTATE=42704',
        sqlcode: -204,
        state: '42704',
      };

      const enhancedError = client.handleError(originalError);

      expect(enhancedError.name).toBe('DB2Error');
      expect(enhancedError.sqlCode).toBe(-204);
      expect(enhancedError.sqlState).toBe('42704');
      expect(enhancedError.errorType).toBe('OBJECT_NOT_FOUND');
      expect(enhancedError.originalError).toBe(originalError);
      expect(enhancedError.message).toBe('SQL0204N TEST.NONEXISTENT is an undefined name. SQLSTATE=42704');
    });

    test('should handle syntax errors', () => {
      const syntaxError = {
        message: 'SQL0104N An unexpected token SELCT was found following . SQLSTATE=42601',
        sqlcode: -104,
        state: '42601',
      };

      const enhancedError = client.handleError(syntaxError);

      expect(enhancedError.errorType).toBe('SYNTAX_ERROR');
      expect(enhancedError.sqlCode).toBe(-104);
      expect(enhancedError.sqlState).toBe('42601');
    });

    test('should handle duplicate key errors', () => {
      const duplicateKeyError = {
        message: 'SQL0803N One or more values in the INSERT statement, UPDATE statement',
        sqlcode: -803,
        state: '23505',
      };

      const enhancedError = client.handleError(duplicateKeyError);

      expect(enhancedError.errorType).toBe('DUPLICATE_KEY');
      expect(enhancedError.sqlCode).toBe(-803);
      expect(enhancedError.sqlState).toBe('23505');
    });

    test('should handle connection errors', () => {
      const connectionError = {
        message: 'SQL30081N A communication error has been detected',
        sqlcode: -30081,
        state: '08001',
      };

      const enhancedError = client.handleError(connectionError);

      expect(enhancedError.errorType).toBe('CONNECTION_FAILED');
      expect(enhancedError.sqlCode).toBe(-30081);
      expect(enhancedError.sqlState).toBe('08001');
    });

    test('should handle deadlock errors', () => {
      const deadlockError = {
        message: 'SQL0913N Unsuccessful execution caused by a deadlock or timeout',
        sqlcode: -913,
        state: '40001',
      };

      const enhancedError = client.handleError(deadlockError);

      expect(enhancedError.errorType).toBe('DEADLOCK_DETECTED');
      expect(enhancedError.sqlCode).toBe(-913);
      expect(enhancedError.sqlState).toBe('40001');
    });

    test('should return original error when not a DB2 error', () => {
      const genericError = {
        message: 'Connection failed',
      };

      const result = client.handleError(genericError);

      expect(result).toBe(genericError); // Should return the same object
      expect(result.message).toBe('Connection failed');
    });

    test('should handle errors with string sqlcode', () => {
      const errorWithStringCode = {
        message: 'SQL0204N Table not found',
        sqlcode: '-204',
        state: '42704',
      };

      const enhancedError = client.handleError(errorWithStringCode);

      expect(enhancedError.sqlCode).toBe('-204'); // String sqlcode is preserved
      expect(enhancedError.errorType).toBe('OBJECT_NOT_FOUND');
    });

    test('should preserve error stack trace', () => {
      const errorWithStack = new Error('Test error');
      errorWithStack.sqlcode = -204;
      errorWithStack.state = '42704';

      const enhancedError = client.handleError(errorWithStack);

      expect(enhancedError.stack).toBeDefined();
      expect(enhancedError.stack).toContain('Test error');
    });
  });

  describe('Error Classification', () => {
    test('should identify retriable errors', () => {
      const retriableErrors = [
        { sqlcode: -30081 }, // CONNECTION_FAILED
        { sqlcode: -30082 }, // CONNECTION_TIMEOUT
        { sqlcode: -911 }, // LOCK_TIMEOUT
        { sqlcode: -913 }, // DEADLOCK_DETECTED
      ];

      retriableErrors.forEach((error) => {
        const enhanced = client.handleError(error);
        const errorType = enhanced.errorType;
        expect(['CONNECTION_FAILED', 'AUTHENTICATION_FAILED', 'LOCK_TIMEOUT', 'DEADLOCK_DETECTED']).toContain(errorType);
      });
    });

    test('should identify non-retriable errors', () => {
      const nonRetriableErrors = [
        { sqlcode: -104 }, // SYNTAX_ERROR
        { sqlcode: -204 }, // OBJECT_NOT_FOUND
        { sqlcode: -206 }, // COLUMN_NOT_FOUND
        { sqlcode: -407 }, // NULL_VALUE_NOT_ALLOWED
      ];

      nonRetriableErrors.forEach((error) => {
        const enhanced = client.handleError(error);
        const errorType = enhanced.errorType;
        expect(['SYNTAX_ERROR', 'OBJECT_NOT_FOUND', 'COLUMN_NOT_FOUND', 'NULL_VALUE_NOT_ALLOWED']).toContain(
          errorType
        );
      });
    });
  });
});
