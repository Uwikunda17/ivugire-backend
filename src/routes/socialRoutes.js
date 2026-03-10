const express = require('express')
const {
  toggleFollow,
  getFollowStatus,
  getUserProfile,
  getUserProfileByUsername,
  getFollowers,
  getFollowing,
  getMessageRequests,
  acceptMessageRequest,
  declineMessageRequest,
  getActiveCalls,
  getCallHistory,
} = require('../controllers/socialController')
const { authMiddleware } = require('../middlewares/auth')
const { asyncHandler } = require('../utils/asyncHandler')

const router = express.Router()

// Follow/unfollow endpoints
router.post('/users/:userId/follow', authMiddleware, asyncHandler(toggleFollow))
router.get('/users/:userId/follow-status', authMiddleware, asyncHandler(getFollowStatus))

// User profile endpoints
router.get('/users/:username/profile-by-username', authMiddleware, asyncHandler(getUserProfileByUsername))
router.get('/users/:userId/profile', authMiddleware, asyncHandler(getUserProfile))
router.get('/users/:userId/followers', authMiddleware, asyncHandler(getFollowers))
router.get('/users/:userId/following', authMiddleware, asyncHandler(getFollowing))

// Message requests
router.get('/message-requests', authMiddleware, asyncHandler(getMessageRequests))
router.post('/message-requests/:requestId/accept', authMiddleware, asyncHandler(acceptMessageRequest))
router.post('/message-requests/:requestId/decline', authMiddleware, asyncHandler(declineMessageRequest))

// Call routes
router.get('/calls/active', authMiddleware, asyncHandler(getActiveCalls))
router.get('/chats/:chatId/call-history', authMiddleware, asyncHandler(getCallHistory))

module.exports = router
