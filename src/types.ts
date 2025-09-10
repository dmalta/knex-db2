import { Client } from 'knex';

export interface Db2ConnectionConfig {
  database: string;
  hostname: string;
  port?: number;
  uid: string;
  pwd: string;
  connectTimeout?: number;
  loginTimeout?: number;
  schema?: string;
  ssl?: boolean | object;
}

export interface Db2Config {
  client: 'db2';
  connection: Db2ConnectionConfig;
  pool?: {
    min?: number;
    max?: number;
    acquireTimeoutMillis?: number;
    createTimeoutMillis?: number;
    destroyTimeoutMillis?: number;
    idleTimeoutMillis?: number;
    reapIntervalMillis?: number;
    createRetryIntervalMillis?: number;
  };
}
