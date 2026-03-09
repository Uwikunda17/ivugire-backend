const express = require('express')
const {
  createStory,
  repostStory,
  listActiveStories,
  listMyStories,
  viewStory,
  listStoryViewers,
} = require('../controllers/storyController')
const { authMiddleware } = require('../middlewares/auth')
const { upload } = require('../middlewares/upload')
const { asyncHandler } = require('../utils/asyncHandler')

const router = express.Router()

router.get('/stories/active', authMiddleware, asyncHandler(listActiveStories))
router.get('/stories/me', authMiddleware, asyncHandler(listMyStories))
router.post('/stories', authMiddleware, upload.single('media'), asyncHandler(createStory))
router.post('/stories/:storyId/repost', authMiddleware, asyncHandler(repostStory))
router.post('/stories/:storyId/view', authMiddleware, asyncHandler(viewStory))
router.get('/stories/:storyId/viewers', authMiddleware, asyncHandler(listStoryViewers))

module.exports = router
