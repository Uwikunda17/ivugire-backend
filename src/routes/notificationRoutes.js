const express = require('express')
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  searchExplore,
  getTrending,
} = require('../controllers/notificationController')
const { authMiddleware } = require('../middlewares/auth')
const { asyncHandler } = require('../utils/asyncHandler')

const router = express.Router()

// Notification endpoints
router.get('/notifications', authMiddleware, asyncHandler(getNotifications))
router.get('/notifications/unread/count', authMiddleware, asyncHandler(getUnreadCount))
router.post('/notifications/:notificationId/read', authMiddleware, asyncHandler(markAsRead))
router.post('/notifications/mark-all-read', authMiddleware, asyncHandler(markAllAsRead))
router.delete('/notifications/:notificationId', authMiddleware, asyncHandler(deleteNotification))

// Explore endpoints
router.get('/explore/search', authMiddleware, asyncHandler(searchExplore))
router.get('/explore/trending', authMiddleware, asyncHandler(getTrending))

module.exports = router
