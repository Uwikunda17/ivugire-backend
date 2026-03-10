const jwt = require('jsonwebtoken')
const { pool } = require('../db/pool')

async function userInChat(userId, chatId) {
  const result = await pool.query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId],
  )
  return result.rowCount > 0
}

// Store active users for online status
const activeUsers = new Map()

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
    const userId = socket.user?.id

    // Track online status
    if (userId) {
      activeUsers.set(userId, {
        socketId: socket.id,
        connectedAt: Date.now(),
      })
      io.emit('user:online', { userId })
    }

    // Disconnect user when they leave
    socket.on('disconnect', () => {
      if (userId) {
        activeUsers.delete(userId)
        io.emit('user:offline', { userId })
      }
    })

    // Chat events
    socket.on('chat:join', async ({ chatId }) => {
      if (!chatId || !socket.user?.id) return
      if (!(await userInChat(socket.user.id, chatId))) return
      socket.join(`chat:${chatId}`)
      
      // Notify others that user joined
      socket.to(`chat:${chatId}`).emit('chat:user-joined', {
        chatId,
        userId: socket.user.id,
      })
    })

    socket.on('chat:leave', ({ chatId }) => {
      if (!chatId) return
      socket.leave(`chat:${chatId}`)
      socket.to(`chat:${chatId}`).emit('chat:user-left', {
        chatId,
        userId: socket.user.id,
      })
    })

    // Typing indicator
    socket.on('chat:typing', async ({ chatId, typing }) => {
      if (!chatId || !socket.user?.id) return
      if (!(await userInChat(socket.user.id, chatId))) return
      socket.to(`chat:${chatId}`).emit('chat:typing', {
        chatId,
        userId: socket.user.id,
        userName: socket.user.name,
        typing: !!typing,
      })
    })

    // Notification events
    socket.on('notification:read', ({ notificationId }) => {
      if (!userId) return
      // Broadcast that notification was read
      io.to(`user:${userId}`).emit('notification:read', { notificationId })
    })

    // Get online users status
    socket.on('users:online-status', ({ userIds }) => {
      if (!userIds || !Array.isArray(userIds)) return
      const onlineUsers = userIds.filter((uid) => activeUsers.has(uid))
      socket.emit('users:online-status', { onlineUsers })
    })

    // Real-time message delivery
    socket.on('message:delivered', ({ chatId, messageId }) => {
      if (!chatId) return
      io.to(`chat:${chatId}`).emit('message:delivered', {
        messageId,
        deliveredAt: new Date().toISOString(),
      })
    })
  })

  // Expose method to emit notifications from backend
  io.emitNotification = function (userId, notification) {
    this.to(`user:${userId}`).emit('notification', notification)
  }

  io.getActiveUsers = function () {
    return Array.from(activeUsers.keys())
  }

  return io
}

module.exports = { createSocketServer }
