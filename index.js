const http = require('http')
const app = require('./src/app')
const { initDb } = require('./src/db/initDb')
const { pool } = require('./src/db/pool')
const { createSocketServer } = require('./src/realtime/socket')

const PORT = process.env.PORT || 4000

async function startServer() {
  try {
    await initDb()

    const server = http.createServer(app)
    const io = createSocketServer(server)
    app.set('io', io)

    server.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`API running on http://localhost:${PORT}`)
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to start API', error)
    process.exit(1)
  }
}

process.on('SIGINT', async () => {
  await pool.end()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await pool.end()
  process.exit(0)
})

startServer()
