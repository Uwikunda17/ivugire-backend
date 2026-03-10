const express = require('express')
const { exploreSearch, exploreTrending } = require('../controllers/exploreController')
const { authMiddleware } = require('../middlewares/auth')
const { asyncHandler } = require('../utils/asyncHandler')

const router = express.Router()

// Search users
router.get('/explore/search', authMiddleware, asyncHandler(exploreSearch))

// Get trending users or hashtags
router.get('/explore/trending', authMiddleware, asyncHandler(exploreTrending))

module.exports = router
