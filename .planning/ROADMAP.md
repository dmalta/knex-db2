# Roadmap

## Milestone 1 — Core Dialect Correctness ✅ SHIPPED v1.1

**Archive:** `.planning/milestones/v1.1-ROADMAP.md`

- ~~Phase 01: fix-gaps~~ — All 6 plans complete. Shipped v1.1 (0e9a07e → 0fd1852).

---

## Milestone 2 — Integration Testing ✅ SHIPPED v1.2

**Archive:** `.planning/milestones/v1.2-ROADMAP.md`

- ~~Phase 02: integration-tests~~ — 2/2 plans complete. IT-QUERY, IT-TX, IT-COLTYPE, IT-DDL all PASS.
- ~~Phase 03: Bulk Insert via ibm_db~~ — 2/2 plans complete. ibm_db column-wise ARRAY-param fast path shipped.

---

## Milestone 3 — Test Coverage

### Phase 04: Improve test coverage

**Goal:** Achieve ≥80% (ideally ≥90%) coverage of critical code paths. Reconsider all existing tests for usefulness and value. Add unit and integration tests where coverage is missing.
**Depends on:** Phase 03
**Plans:** 3 plans

**Requirements:**
- COV-01: client.js connection lifecycle coverage ≥90% (acquireRawConnection, buildConnectionString optional params, destroyRawConnection, setConnectionOptions)
- COV-02: client.js query execution path coverage ≥90% (_executeBulkInsert error, _executeDML positive SQLCODE, _executeDDL suppressIfNotFound, _executeQuery error paths, query timeout, processResponse all branches)
- COV-03: db2-tablecompiler.js coverage ≥90% (createTableLike, tablespace, alterColumns nullable/default, dropUnique/Foreign/Primary, _setNullableState)
- COV-04: db2-transaction.js coverage ≥90% (savepoint, release, rollbackTo)
- COV-05: db2-schemacompiler.js coverage ≥90% (dropTableIfExists/createSchemaIfNotExists/dropSchemaIfExists throws, dropSchema cascade)
- COV-06: db2-columncompiler.js coverage ≥90% (bigincrements no-PK, timestamp useTz throw, datetime passthrough)
- COV-07: db2-querycompiler.js coverage ≥90% (columnInfo output() named-key rows, array-style rows, resp.rows format, specific column lookup)

Plans:
- [ ] 04-01-PLAN.md — Extend client.test.js: connection lifecycle + query execution path gaps
- [ ] 04-02-PLAN.md — Extend table-transaction.test.js: tablecompiler missing methods + transaction savepoints
- [ ] 04-03-PLAN.md — Extend schema-compilers.test.js: schemacompiler/columncompiler/querycompiler edge cases