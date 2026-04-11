# Roadmap

## Milestone 1 — Core Dialect Correctness ✅ SHIPPED v1.1

**Archive:** `.planning/milestones/v1.1-ROADMAP.md`

- ~~Phase 01: fix-gaps~~ — All 6 plans complete. Shipped v1.1 (0e9a07e → 0fd1852).

---

## Milestone 2 — Integration Testing

**Goal:** Comprehensive real-world integration test suite against a live DB2 z/OS instance.

**Version:** 1.2.0

### Phase 02: integration-tests

**Goal:** Comprehensive real-world integration test suite for DB2 with isolated execution, connection config file, and full DDL/DML coverage.

**Status:** planned

**Requirements**: TBD
**Depends on:** Phase 01
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 2 to break down)

### Phase 3: Bulk Insert via ibm_db

**Goal:** Implement ibm_db column-wise array-insert fast path so multi-row inserts execute in a single ODBC call instead of invalid multi-VALUES SQL.
**Requirements**: BULK-01, BULK-02, BULK-03
**Depends on:** Phase 2
**Plans:** 2 plans

Requirements:
- BULK-01: Override `insert()` in Db2QueryCompiler to emit single-row SQL template + `__db2BulkInsert` property for multi-row data
- BULK-02: Add bulk fast path in `Db2Client.query()` that transposes to column-wise ARRAY params and calls `connection.query({ sql, params, ArraySize })`
- BULK-03: Unit tests covering multi-row ARRAY params, single-row bypass, and fallback when `connection.query` is absent

Plans:
- [x] 03-01-PLAN.md — Compiler insert() override + client fast path (Wave 1)
- [x] 03-02-PLAN.md — Bulk insert unit tests (Wave 2)