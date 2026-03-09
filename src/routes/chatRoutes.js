const express = require('express')
const {
  listChats,
  searchUsers,
  createDirectChat,
  listMessages,
  sendMessage,
  toggleReaction,
  deleteMessage,
} = require('../controllers/chatController')
const { authMiddleware } = require('../middlewares/auth')
const { upload } = require('../middlewares/upload')
const { asyncHandler } = require('../utils/asyncHandler')

const router = express.Router()

router.get('/chats', authMiddleware, asyncHandler(listChats))
router.get('/users/search', authMiddleware, asyncHandler(searchUsers))
router.post('/chats/direct', authMiddleware, asyncHandler(createDirectChat))
router.get('/chats/:chatId/messages', authMiddleware, asyncHandler(listMessages))
router.post('/chats/:chatId/messages', authMiddleware, upload.array('media', 10), asyncHandler(sendMessage))
router.post('/chats/:chatId/messages/:messageId/reactions', authMiddleware, asyncHandler(toggleReaction))
router.delete('/chats/:chatId/messages/:messageId', authMiddleware, asyncHandler(deleteMessage))

module.exports = router
