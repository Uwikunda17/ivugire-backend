const { Pool } = require('pg')

const pool = new Pool(
  process.env.DATABASE_URL ? {
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PGPOOL_MAX || 10),
  } : {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'jules098765',
    database: process.env.PGDATABASE || 'ivugire',
    max: Number(process.env.PGPOOL_MAX || 10),
  }
)

module.exports = { pool }
