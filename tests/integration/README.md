# Integration Test Configuration

## Setup

1. Copy the example config file:
   ```bash
   cp db2-config-example.json db2-config.json
   ```

2. Update `db2-config.json` with your actual DB2 connection credentials:
   ```json
   {
     "hostname": "your-actual-hostname.com",
     "port": 3906,
     "database": "YOUR_DB",
     "user": "YOUR_USERNAME", 
     "password": "YOUR_PASSWORD",
     "schema": "YOUR_SCHEMA.YOUR_TABLESPACE"
   }
   ```

## Configuration Fields

- `hostname`: DB2 server hostname
- `port`: DB2 server port (typically 3906)
- `database`: Database name
- `user`: Username for authentication
- `password`: Password for authentication
- `schema`: Schema and tablespace for DDL operations

## Security Note

- `db2-config.json` is ignored by git to prevent credentials from being committed
- `db2-config-example.json` contains dummy values and is tracked in git
- If `db2-config.json` doesn't exist, tests will fall back to the example config

## Running Tests

```bash
npm test -- --testPathPatterns=integration
```
