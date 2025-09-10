/**
 * Test file for DB2 error handling functionality
 */

const { handleDB2Error, isDB2ErrorCode, isRetryableError, DB2Error } = require('../db2-errors');

describe('DB2 Error Handling Module', () => {
  test('should handle basic DB2 errors correctly', () => {
    const mockError = {
      message: 'Table not found',
      sqlcode: -204,
      state: '42704'
    };
    
    const enhancedError = handleDB2Error(mockError, 'SELECT * FROM nonexistent_table', []);
    
    expect(enhancedError).toBeInstanceOf(DB2Error);
    expect(enhancedError.name).toBe('DB2Error');
    expect(enhancedError.errorType).toBe('OBJECT_NOT_FOUND');
    expect(enhancedError.errorCategory).toBe('SCHEMA');
    expect(enhancedError.isRetryable()).toBe(false);
    expect(enhancedError.sql).toBe('SELECT * FROM nonexistent_table');
  });

  test('should handle authorization errors correctly', () => {
    const authError = {
      message: 'Insufficient privileges',
      sqlcode: -551,
      state: '42501'
    };
    
    const enhancedError = handleDB2Error(authError);
    
    expect(enhancedError.errorType).toBe('INSUFFICIENT_PRIVILEGES');
    expect(enhancedError.errorCategory).toBe('AUTHORIZATION');
    expect(enhancedError.getUserMessage()).toBe('You do not have permission to perform this operation.');
  });

  test('should identify retryable errors correctly', () => {
    const lockError = {
      message: 'Deadlock detected',
      sqlcode: -913
    };
    
    const enhancedError = handleDB2Error(lockError);
    
    expect(enhancedError.errorType).toBe('DEADLOCK_DETECTED');
    expect(enhancedError.isRetryable()).toBe(true);
    expect(enhancedError.getUserMessage()).toBe('A deadlock was detected. Please try again.');
  });

  test('should test utility functions correctly', () => {
    const testError = new DB2Error({
      message: 'Duplicate key',
      sqlcode: -803
    });
    
    expect(isDB2ErrorCode(testError, -803)).toBe(true);
    expect(isDB2ErrorCode(testError, -804)).toBe(false);
    expect(isRetryableError(testError)).toBe(false);
    
    const errorJSON = testError.toJSON();
    expect(errorJSON.name).toBe('DB2Error');
    expect(errorJSON.errorType).toBe('DUPLICATE_KEY');
    expect(errorJSON.errorCategory).toBe('CONSTRAINT');
  });

  test('should handle non-DB2 errors by returning them unchanged', () => {
    const regularError = new Error('Regular JavaScript error');
    const result = handleDB2Error(regularError);
    
    expect(result).toBe(regularError);
    expect(result).not.toBeInstanceOf(DB2Error);
  });

  test('should categorize authorization errors correctly', () => {
    const authErrors = [
      { sqlcode: -551, expected: 'INSUFFICIENT_PRIVILEGES' },
      { sqlcode: -552, expected: 'AUTHORIZATION_FAILURE' },
      { sqlcode: -553, expected: 'AUTHORIZATION_NAME_INVALID' },
      { sqlcode: -554, expected: 'CANNOT_GRANT_PRIVILEGE' },
      { sqlcode: -555, expected: 'CANNOT_REVOKE_PRIVILEGE' }
    ];

    authErrors.forEach(({ sqlcode, expected }) => {
      const error = { message: 'Auth error', sqlcode };
      const enhanced = handleDB2Error(error);
      
      expect(enhanced.errorType).toBe(expected);
      expect(enhanced.errorCategory).toBe('AUTHORIZATION');
    });
  });
});
