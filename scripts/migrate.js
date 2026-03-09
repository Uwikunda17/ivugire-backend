const { Pool } = require('pg')
require('dotenv').config()

const sourcePool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'jules098765',
  database: 'ivugire',
})

const targetPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

async function migrate() {
  const sourceClient = await sourcePool.connect()
  const targetClient = await targetPool.connect()

  try {
    console.log('🔄 Starting migration from local to Render PostgreSQL...')

    // Get all tables from source database
    const tablesResult = await sourceClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)

    const tables = tablesResult.rows.map(row => row.table_name)
    console.log(`📋 Found ${tables.length} tables to migrate:`, tables)
    
    // Sort tables by dependency (tables without FK first)
    const sortedTables = sortTablesByDependency(tables, sourceClient)
    console.log(`📊 Migration order:`, sortedTables)

    for (const table of sortedTables) {
      try {
        // Get all data from source table
        const dataResult = await sourceClient.query(`SELECT * FROM "${table}"`)
        const rows = dataResult.rows

        if (rows.length === 0) {
          console.log(`📊 Migrating table: ${table}`)
          console.log(`  ℹ️  Table is empty, skipping data migration`)
          continue
        }

        console.log(`📊 Migrating table: ${table}`)

        // Insert data into target table
        for (const row of rows) {
          const columns = Object.keys(row)
          const values = columns.map(col => row[col])
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
          const columnNames = columns.map(col => `"${col}"`).join(', ')

          const insertQuery = `INSERT INTO "${table}" (${columnNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`

          try {
            await targetClient.query(insertQuery, values)
          } catch (error) {
            console.error(`  ⚠️  Skipped row in ${table}:`, error.message)
          }
        }

        console.log(`  ✅ Migrated ${rows.length} rows to ${table}`)
      } catch (tableError) {
        console.error(`  ⚠️  Error migrating table ${table}:`, tableError.message)
      }
    }

    console.log('\n✨ Migration complete!')
  } catch (error) {
    console.error('❌ Migration failed:', error)
  } finally {
    await sourceClient.release()
    await targetClient.release()
    await sourcePool.end()
    await targetPool.end()
  }
}

function sortTablesByDependency(tables, client) {
  // Manual dependency order based on FK relationships
  const dependencyMap = {
    users: [],
    chats: ['users'],
    posts: ['users'],
    stories: ['users'],
    post_likes: ['posts', 'users'],
    post_comments: ['posts', 'users'],
    post_shares: ['posts', 'users'],
    post_views: ['posts', 'users'],
    story_tags: ['stories'],
    story_views: ['stories', 'users'],
    messages: ['chats', 'users'],
    chat_members: ['chats', 'users'],
    message_attachments: ['messages'],
    message_reactions: ['messages', 'users'],
    message_shares: ['messages', 'users'],
  }

  const sorted = []
  const visited = new Set()

  function visit(table) {
    if (visited.has(table)) return
    visited.add(table)

    const deps = dependencyMap[table] || []
    for (const dep of deps) {
      if (tables.includes(dep)) {
        visit(dep)
      }
    }
    sorted.push(table)
  }

  for (const table of tables) {
    visit(table)
  }

  return sorted
}

migrate()
