/**
 * Test to verify that db2-errors exports are available from the main index
 */

const knexDb2 = require('../index');

describe('Main Index Exports', () => {
  test('should export the main client', () => {
    expect(typeof knexDb2).toBe('function');
  });

  test('should export all error handling utilities', () => {
    expect(typeof knexDb2.DB2Error).toBe('function');
    expect(typeof knexDb2.handleDB2Error).toBe('function');
    expect(typeof knexDb2.getErrorType).toBe('function');
    expect(typeof knexDb2.getErrorCategory).toBe('function');
    expect(typeof knexDb2.isDB2ErrorCode).toBe('function');
    expect(typeof knexDb2.isRetryableError).toBe('function');
    expect(typeof knexDb2.DB2_ERROR_MAP).toBe('object');
    expect(typeof knexDb2.ERROR_CATEGORIES).toBe('object');
  });

  test('should have functional error handling exports', () => {
    // Test error creation
    const testError = new knexDb2.DB2Error({
      message: 'Test error',
      sqlcode: -204
    });

    expect(testError).toBeInstanceOf(knexDb2.DB2Error);
    expect(testError.errorType).toBe('OBJECT_NOT_FOUND');

    // Test utility functions
    expect(knexDb2.getErrorType(-204)).toBe('OBJECT_NOT_FOUND');
    expect(knexDb2.getErrorCategory('OBJECT_NOT_FOUND')).toBe('SCHEMA');
    expect(knexDb2.isDB2ErrorCode(testError, -204)).toBe(true);
    expect(knexDb2.isRetryableError(testError)).toBe(false);
  });

  test('should have comprehensive error mappings', () => {
    expect(Object.keys(knexDb2.DB2_ERROR_MAP).length).toBeGreaterThan(50);
    expect(Object.keys(knexDb2.ERROR_CATEGORIES).length).toBeGreaterThan(5);
  });
});
