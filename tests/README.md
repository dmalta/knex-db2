# Test Structure Documentation

## Overview

The test suite has been reorganized into a logical, structured hierarchy that separates concerns and makes testing more maintainable.

## Directory Structure

```
src/__tests__/
├── unit/                          # Unit tests (no database connection required)
│   ├── client.test.js            # DB2 client class unit tests
│   ├── compilers.test.js         # Query/schema compiler tests
│   └── error-handling.test.js    # Error handling and mapping tests
├── integration/                   # Integration tests (require real DB2 connection)
│   ├── connection.test.js        # Connection management and basic queries
│   ├── queries.test.js           # Complex query operations
│   └── schema.test.js            # Schema operations (DDL)
├── helpers/
│   └── test-config.js            # Shared configuration and utilities
└── integration.test.js           # Legacy integration test (kept for compatibility)
```

## Test Types

### Unit Tests (`test:unit`)
- **No database connection required**
- Test client instantiation and configuration
- Test SQL compilation and query building
- Test error handling logic
- Fast execution, suitable for CI/CD

**Run with:** `npm run test:unit`

### Integration Tests (`test:integration`)
- **Require real DB2 connection** when `DB2_REAL_TEST=true`
- Test actual database operations
- Test real query execution
- Test schema operations (DDL)
- Automatically skip when environment variable not set

**Run with:** 
- `npm run test:integration` (skips tests without real DB)
- `npm run test:real` (runs with DB2_REAL_TEST=true)

## Test Configuration

### Environment Variables
- `DB2_REAL_TEST=true` - Enable integration tests against real DB2

### Shared Configuration
All test configuration is centralized in `helpers/test-config.js`:
- PIMS database connection settings
- Pool configuration
- Test timeouts
- Environment checks

## Test Scripts

| Script | Description |
|--------|-------------|
| `npm test` | Run all tests |
| `npm run test:unit` | Run only unit tests |
| `npm run test:integration` | Run integration tests (skip if no real DB) |
| `npm run test:real` | Run integration tests with real DB2 connection |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |

## Test Features

### Automatic Skipping
Integration tests automatically skip when `DB2_REAL_TEST` is not set, providing clear console messages about why tests are being skipped.

### Comprehensive Coverage
- **Client functionality**: Identifier wrapping, connection validation, compiler integration
- **SQL Generation**: Query compilation, schema operations, error handling
- **Real DB Operations**: Connection pooling, query execution, transaction handling
- **Error Scenarios**: SQL syntax errors, connection failures, timeout handling

### Clean Structure
- Tests are organized by functionality rather than by file
- Shared utilities prevent code duplication
- Clear separation between unit and integration concerns
- Consistent naming and organization patterns

## Development Workflow

1. **Write unit tests first** - Test logic without database dependencies
2. **Add integration tests** - Test real database operations when needed
3. **Use appropriate test type** - Unit tests for logic, integration for DB operations
4. **Keep tests focused** - Each test should test one specific behavior

This structure makes the test suite more maintainable, faster to run, and easier to understand.
