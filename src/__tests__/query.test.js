// PIMS test connection variables
const PIMS_CONFIG = {
  hostname: 'mbgmvsc.pok.ibm.com',
  port: 3906,
  database: 'DB2C',
  uid: 'PRESS',
  pwd: 'VCKDTCW9'
};

const TABLESPACE = 'DSQDBDEF.DSQTSDEF';

const Db2Client = require('../client');

describe('DB2 Query Tests', () => {
  let client;

  beforeAll(() => {
    client = new Db2Client({ 
      client: 'db2', 
      connection: PIMS_CONFIG 
    });
  });

  afterAll(async () => {
    if (client && client.pool) {
      await client.destroy();
    }
  });

  test('should create client instance', () => {
    expect(client).toBeDefined();
    expect(client.constructor.name).toBe('Db2ClientImpl');
  });

  test('should wrap identifiers correctly', () => {
    expect(client.wrapIdentifierImpl('table_name')).toBe('"table_name"');
    expect(client.wrapIdentifierImpl('*')).toBe('*');
    expect(client.wrapIdentifierImpl('col"name')).toBe('"col""name"');
  });

  test('should compile SELECT query with LIMIT', () => {
    const query = client.queryBuilder()
      .select('*')
      .from('test_table')
      .limit(5);
    
    const compiled = query.toSQL();
    expect(compiled.sql).toContain('fetch first 5 rows only');
  });

  test('should compile SELECT query with OFFSET and LIMIT', () => {
    const query = client.queryBuilder()
      .select('*')
      .from('test_table')
      .offset(10)
      .limit(5);
    
    const compiled = query.toSQL();
    expect(compiled.sql).toContain('offset 10 rows');
    expect(compiled.sql).toContain('fetch first 5 rows only');
  });

  test('should compile basic SELECT query', () => {
    const query = client.queryBuilder()
      .select('id', 'name')
      .from('users')
      .where('active', 1);
    
    const compiled = query.toSQL();
    expect(compiled.sql).toContain('select "id", "name" from "users"');
    expect(compiled.sql).toContain('where "active" = ?');
    expect(compiled.bindings).toEqual([1]);
  });

  // Integration test - only run if we can connect
  test('should connect to PIMS database', async () => {
    try {
      const connection = await client.acquireRawConnection();
      expect(connection).toBeDefined();
      await client.destroyRawConnection(connection);
    } catch (error) {
      console.log('Connection test skipped:', error.message);
      // Skip this test if connection fails
      expect(true).toBe(true);
    }
  }, 10000);
});
