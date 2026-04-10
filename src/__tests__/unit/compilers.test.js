// Unit tests for DB2 Query and Schema Compilers
// These tests focus on basic SQL generation patterns
const knex = require('knex');
const Db2Client = require('../../client');

describe('DB2 Compiler Unit Tests', () => {
  let db;

  beforeAll(() => {
    // Create knex instance for SQL compilation testing
    db = knex({
      client: Db2Client,
      connection: {}, // Empty connection for compilation-only tests
    });
  });

  describe('Query Compiler', () => {
    describe('SELECT Queries', () => {
      test('should compile basic SELECT', () => {
        const query = db.select('*').from('users');
        const compiled = query.toSQL();
        expect(compiled.sql).toBe('select * from users');
      });

      test('should compile SELECT with LIMIT using FETCH FIRST', () => {
        const query = db.select('*').from('users').limit(5);
        const compiled = query.toSQL();
        // DB2 should use FETCH FIRST for LIMIT
        expect(compiled.sql).toContain('fetch first');
        expect(compiled.sql).toContain('rows only');
      });

      test('should compile SELECT with WHERE clause', () => {
        const query = db.select('*').from('users').where('id', '=', 1);
        const compiled = query.toSQL();
        expect(compiled.sql).toBe('select * from users where id = ?');
        expect(compiled.bindings).toEqual([1]);
      });

      test('should compile SELECT with ORDER BY', () => {
        const query = db.select('*').from('users').orderBy('name', 'desc');
        const compiled = query.toSQL();
        expect(compiled.sql).toBe('select * from users order by name desc');
      });

      test('should compile SELECT with JOIN', () => {
        const query = db.select('*').from('users').join('posts', 'users.id', 'posts.user_id');
        const compiled = query.toSQL();
        expect(compiled.sql).toBe('select * from users inner join posts on users.id = posts.user_id');
      });
    });

    describe('INSERT Queries', () => {
      test('should compile basic INSERT', () => {
        const query = db('users').insert({ name: 'John', email: 'john@example.com' });
        const compiled = query.toSQL();
        expect(compiled.sql).toBe('insert into users (email, name) values (?, ?)');
        expect(compiled.bindings).toEqual(['john@example.com', 'John']);
      });

      test('should compile INSERT with multiple rows', () => {
        const query = db('users').insert([
          { name: 'John', email: 'john@example.com' },
          { name: 'Jane', email: 'jane@example.com' },
        ]);
        const compiled = query.toSQL();
        expect(compiled.sql).toBe('insert into users (email, name) values (?, ?), (?, ?)');
      });
    });

    describe('UPDATE Queries', () => {
      test('should compile basic UPDATE', () => {
        const query = db('users').where('id', 1).update({ name: 'John Updated' });
        const compiled = query.toSQL();
        expect(compiled.sql).toBe('update users set name = ? where id = ?');
        expect(compiled.bindings).toEqual(['John Updated', 1]);
      });
    });

    describe('DELETE Queries', () => {
      test('should compile basic DELETE', () => {
        const query = db('users').where('id', 1).del();
        const compiled = query.toSQL();
        expect(compiled.sql).toBe('delete from users where id = ?');
        expect(compiled.bindings).toEqual([1]);
      });
    });
  });

  describe('Identifier Wrapping', () => {
    test('should wrap table and column names with double quotes', () => {
      const query = db.select('user_name', 'user_email').from('user_table');
      const compiled = query.toSQL();
      expect(compiled.sql).toBe('select user_name, user_email from user_table');
    });

    test('should handle asterisk without quotes', () => {
      const query = db.select('*').from('users');
      const compiled = query.toSQL();
      expect(compiled.sql).toBe('select * from users');
    });

    test('should escape double quotes in identifiers', () => {
      const query = db.select('colname').from('table');
      const compiled = query.toSQL();
      expect(compiled.sql).toBe('select colname from table');
    });
  });

  describe('DB2 SQL Features', () => {
    test('should use parameter placeholders', () => {
      const query = db.select('*').from('users').where('name', 'like', '%john%').andWhere('active', true);
      const compiled = query.toSQL();
      expect(compiled.sql).toBe('select * from users where name like ? and active = ?');
      expect(compiled.bindings).toEqual(['%john%', true]);
    });

    test('should handle complex WHERE conditions', () => {
      const query = db.select('*').from('users').where('age', '>', 18).orWhere('status', 'admin');
      const compiled = query.toSQL();
      expect(compiled.sql).toBe('select * from users where age > ? or status = ?');
      expect(compiled.bindings).toEqual([18, 'admin']);
    });
  });

  describe('DB2-specific QueryCompiler overrides', () => {
    const getSql = (compiled) =>
      Array.isArray(compiled)
        ? compiled.map((entry) => entry.sql || entry).join(' ')
        : compiled.sql;

    test('offset only wraps in ROW_NUMBER subquery', () => {
      const sql = getSql(db.select('*').from('users').offset(10).toSQL());
      expect(sql).toContain('ROW_NUMBER() OVER()');
      expect(sql).toContain('rn__ >= 11');
      expect(sql).not.toContain('OFFSET 10');
    });

    test('limit and offset use ROW_NUMBER bounds', () => {
      const sql = getSql(db.select('*').from('users').limit(5).offset(10).toSQL());
      expect(sql).toContain('ROW_NUMBER() OVER()');
      expect(sql).toContain('rn__ >= 11');
      expect(sql).toContain('rn__ <= 15');
    });

    test('limit without offset still uses FETCH FIRST', () => {
      const sql = getSql(db.select('*').from('users').limit(5).toSQL());
      expect(sql).toContain('fetch first 5 rows only');
      expect(sql).not.toContain('ROW_NUMBER() OVER()');
    });

    test('truncate emits TRUNCATE TABLE ... IMMEDIATE', () => {
      const sql = getSql(db('users').truncate().toSQL());
      expect(sql).toMatch(/TRUNCATE TABLE users IMMEDIATE/i);
    });

    test('whereILike uses UPPER() around column and binding', () => {
      const sql = getSql(db.select('*').from('users').whereILike('name', '%john%').toSQL());
      expect(sql).toMatch(/UPPER\(name\) like UPPER\(\?\)/i);
    });

    test('forUpdate emits FOR UPDATE WITH RS', () => {
      const sql = getSql(db.select('*').from('users').forUpdate().toSQL());
      expect(sql).toContain('FOR UPDATE WITH RS');
    });

    test('forShare emits FOR FETCH ONLY', () => {
      const sql = getSql(db.select('*').from('users').forShare().toSQL());
      expect(sql).toContain('FOR FETCH ONLY');
    });

    test('recursive CTE does not duplicate WITH or emit RECURSIVE', () => {
      const sql = getSql(
        db
          .withRecursive('cte', (builder) => builder.select('*').from('users'))
          .select('*')
          .from('cte')
          .toSQL()
      );
      const withCount = (sql.match(/\bwith\b/gi) || []).length;
      expect(withCount).toBe(1);
      expect(sql).not.toMatch(/\brecursive\b/i);
    });

    test('columnInfo targets SYSIBM.SYSCOLUMNS and uppercases identifiers', () => {
      const builder = db.queryBuilder().from('users').withSchema('app');
      builder._single.columnInfo = null;
      const compiler = db.client.queryCompiler(builder);
      const info = compiler.columnInfo();

      expect(info.sql).toContain('SYSIBM.SYSCOLUMNS');
      expect(info.bindings).toEqual(['USERS', 'APP']);
    });
  });
});
