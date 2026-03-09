const express = require('express')
const cors = require('cors')
const routes = require('./routes')
const path = require('path')

const app = express()

app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(path.resolve(__dirname, '..', 'uploads')))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

app.use('/api', routes)

app.use((error, _req, res, _next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'file_too_large' })
  }
  if (error?.message === 'unsupported_media_type') {
    return res.status(400).json({ error: 'unsupported_media_type' })
  }
  if (error?.status === 413 || error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' })
  }
  if (error?.status && typeof error.status === 'number' && error?.message) {
    return res.status(error.status).json({ error: error.message })
  }

  // eslint-disable-next-line no-console
  console.error(error)
  res.status(500).json({ error: 'server_error' })
})

module.exports = app
