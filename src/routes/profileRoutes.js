const express = require('express')
const { getProfile, updateProfile } = require('../controllers/profileController')
const { authMiddleware } = require('../middlewares/auth')
const { asyncHandler } = require('../utils/asyncHandler')

const router = express.Router()

router.get('/profile', authMiddleware, asyncHandler(getProfile))
router.put('/profile', authMiddleware, asyncHandler(updateProfile))

module.exports = router
