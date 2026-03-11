const express = require('express')
const {
  listFeed,
  listReels,
  listMyPosts,
  createPost,
  deletePost,
  toggleLike,
  sharePost,
  listComments,
  addComment,
} = require('../controllers/postController')
const { authMiddleware } = require('../middlewares/auth')
const { upload } = require('../middlewares/upload')
const { asyncHandler } = require('../utils/asyncHandler')

const router = express.Router()

router.get('/feed', authMiddleware, asyncHandler(listFeed))
router.get('/reels', authMiddleware, asyncHandler(listReels))
router.get('/posts/me', authMiddleware, asyncHandler(listMyPosts))
router.post('/posts', authMiddleware, upload.array('media', 13), asyncHandler(createPost))
router.delete('/posts/:postId', authMiddleware, asyncHandler(deletePost))
router.post('/posts/:postId/like', authMiddleware, asyncHandler(toggleLike))
router.post('/posts/:postId/share', authMiddleware, asyncHandler(sharePost))
router.get('/posts/:postId/comments', authMiddleware, asyncHandler(listComments))
router.post('/posts/:postId/comments', authMiddleware, asyncHandler(addComment))

module.exports = router
