const jwt = require('jsonwebtoken')
const { pool } = require('../db/pool')

async function userInChat(userId, chatId) {
  const result = await pool.query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId],
  )
  return result.rowCount > 0
}

function createSocketServer(httpServer) {
  const { Server } = require('socket.io')
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  })

  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1] ||
        null

      if (!token) return next(new Error('missing_auth'))
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret')
      socket.user = payload
      socket.join(`user:${payload.id}`)
      return next()
    } catch (_error) {
      return next(new Error('invalid_token'))
    }
  })

  io.on('connection', (socket) => {
    socket.on('chat:join', async ({ chatId }) => {
      if (!chatId || !socket.user?.id) return
      if (!(await userInChat(socket.user.id, chatId))) return
      socket.join(`chat:${chatId}`)
    })

    socket.on('chat:leave', ({ chatId }) => {
      if (!chatId) return
      socket.leave(`chat:${chatId}`)
    })

    socket.on('chat:typing', async ({ chatId, typing }) => {
      if (!chatId || !socket.user?.id) return
      if (!(await userInChat(socket.user.id, chatId))) return
      socket.to(`chat:${chatId}`).emit('chat:typing', {
        chatId,
        userId: socket.user.id,
        typing: !!typing,
      })
    })
  })

  return io
}

module.exports = { createSocketServer }
