# Changelog

All notable changes to `@dmalta/knex-db2` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [1.2.3] - 2026-10-02

### Added

- `connection.autocommit` option, default `true`. Every pooled connection is put
  in autocommit mode when it is opened, so a plain `SELECT` no longer leaves a
  unit of work open. On DB2 for z/OS an open unit of work keeps its locks and
  claims, and can block other sessions' DDL (`SQL0913N`). Set it to `false` to
  keep the connection exactly as the driver opened it.

### Fixed

- After a Knex transaction commits or rolls back (including a failed commit,
  rollback or begin), autocommit is restored before the connection goes back to
  the pool. If restoring it fails, the connection is discarded instead of reused.
  Previously the setting was read but never applied, and restoring autocommit
  depended on ibm_db doing it inside `endTransaction`.

### Changed

- The `ibm_db` peer dependency range now includes 4.x (`^3.3.2 || ^4.0.0`). The
  test setup moved to `ibm_db` 4.x.
- README: notes on the `ibm_db` install script and the new autocommit option.

## [1.2.2] - 2026-04-11

### Added

- `dropTableIfExists` that ignores "object not found" errors, and
  `createTableIfNotExists` that ignores "object already exists" errors.
- Cleanup of leftover test tables in the integration test setup.

### Changed

- Existing-object errors and SQL warnings are suppressed where Knex expects an
  idempotent operation.
- README: clarified connection options and removed the SSL parameter.

## [1.2.1] - 2026-04-11

### Added

- Custom connection parameters (`connection.params`) appended to the connection
  string built by `buildConnectionString`.

### Changed

- `prepublishOnly` runs the unit tests.
- README: package name, installation and connection options.

## [1.2.0] - 2026-04-11

### Added

- `.returning()` on inserts, using `SELECT ... FROM FINAL TABLE (INSERT ...)`.
- Bulk insert fast path for multi-row inserts using `ibm_db` array parameters.
- Integration tests for DML, DB2-specific queries and transactions.

### Fixed

- `TRUNCATE TABLE` now includes `IMMEDIATE`, which DB2 for z/OS requires.

### Changed

- Test runner moved from Jest to Vitest; unit coverage raised above 90% for the
  schema, table and transaction code.
- More DB2 error codes mapped to error categories.

## [1.1.0] - 2026-04-10

### Added

- DB2 query and column compilers.
- `Db2SchemaCompiler`, with schema operations backed by the `SYSIBM` catalog.
- `Db2TableCompiler`, with `CREATE`, `ALTER` and `DROP` DDL for DB2 for z/OS.
- `Db2Transaction`, wired into the client.

### Removed

- The outdated TypeScript support.

## [1.0.1] - 2025-09-10

### Changed

- Integration and unit tests no longer wrap identifiers.
- Removed the unused schema and table compiler stubs.

## [1.0.0] - 2025-09-10

### Added

- First release: Knex client for IBM DB2 on top of `ibm_db`, with connection
  handling, a query compiler, and DB2 error categorization.

[1.2.3]: https://github.com/dmalta/knex-db2/compare/cd2ff17...HEAD
[1.2.2]: https://github.com/dmalta/knex-db2/compare/5923bd0...cd2ff17
[1.2.1]: https://github.com/dmalta/knex-db2/compare/8753da7...5923bd0
[1.2.0]: https://github.com/dmalta/knex-db2/compare/080729f...8753da7
[1.1.0]: https://github.com/dmalta/knex-db2/compare/8b2dc07...080729f
[1.0.1]: https://github.com/dmalta/knex-db2/compare/522cc7f...8b2dc07
[1.0.0]: https://github.com/dmalta/knex-db2/commits/522cc7f
