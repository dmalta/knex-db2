// PIMS Test Configuration
const PIMS_CONFIG = {
  hostname: 'mbgmvsc.pok.ibm.com',
  port: 3906,
  database: 'DB2C',
  uid: 'PRESS',
  pwd: 'VCKDTCW9'
};

const PIMS_TABLESPACE = 'DSQDBDEF.DSQTSDEF';

const Db2Client = require('../client');

describe('DB2 Query Compiler', () => {
  let client;

  beforeAll(() => {
    client = new Db2Client({
      client: 'db2',
      connection: PIMS_CONFIG
    });
  });

  describe('Query compilation', () => {
    test('should compile basic select query', () => {
      const query = client.queryBuilder()
        .select('*')
        .from('users');
      
      const compiled = query.toQuery();
      expect(compiled).toContain('select * from "users"');
    });

    test('should compile select with limit', () => {
      const query = client.queryBuilder()
        .select('*')
        .from('users')
        .limit(10);
      
      const compiled = query.toQuery();
      expect(compiled).toContain('fetch first 10 rows only');
    });

    test('should compile select with offset and limit', () => {
      const query = client.queryBuilder()
        .select('*')
        .from('users')
        .offset(5)
        .limit(10);
      
      const compiled = query.toQuery();
      expect(compiled).toContain('offset 5 rows');
      expect(compiled).toContain('fetch first 10 rows only');
    });

    test('should compile where clause', () => {
      const query = client.queryBuilder()
        .select('*')
        .from('users')
        .where('id', '=', 1);
      
      const compiled = query.toQuery();
      expect(compiled).toContain('where "id" = ?');
    });

    test('should compile insert query', () => {
      const query = client.queryBuilder()
        .insert({ name: 'John', email: 'john@test.com' })
        .into('users');
      
      const compiled = query.toQuery();
      expect(compiled).toContain('insert into "users"');
      expect(compiled).toContain('"name"');
      expect(compiled).toContain('"email"');
    });

    test('should compile update query', () => {
      const query = client.queryBuilder()
        .table('users')
        .where('id', 1)
        .update({ name: 'Jane' });
      
      const compiled = query.toQuery();
      expect(compiled).toContain('update "users"');
      expect(compiled).toContain('set "name" = ?');
      expect(compiled).toContain('where "id" = ?');
    });

    test('should compile delete query', () => {
      const query = client.queryBuilder()
        .table('users')
        .where('id', 1)
        .del();
      
      const compiled = query.toQuery();
      expect(compiled).toContain('delete from "users"');
      expect(compiled).toContain('where "id" = ?');
    });

    test('should handle joins', () => {
      const query = client.queryBuilder()
        .select('u.name', 'p.title')
        .from('users as u')
        .join('posts as p', 'u.id', 'p.user_id');
      
      const compiled = query.toQuery();
      expect(compiled).toContain('inner join');
      expect(compiled).toContain('"users" as "u"');
      expect(compiled).toContain('"posts" as "p"');
    });
  });

  describe('DB2 specific features', () => {
    test('should wrap identifiers with double quotes', () => {
      expect(client.wrapIdentifierImpl('table_name')).toBe('"table_name"');
      expect(client.wrapIdentifierImpl('*')).toBe('*');
      expect(client.wrapIdentifierImpl('col"name')).toBe('"col""name"');
    });

    test('should handle parameter bindings', () => {
      const sql = 'SELECT * FROM table WHERE id = ? AND name = ?';
      expect(client.positionBindings(sql)).toBe(sql);
    });
  });
});
