const express = require('express')
const { register, login, me } = require('../controllers/authController')
const { authMiddleware } = require('../middlewares/auth')
const { asyncHandler } = require('../utils/asyncHandler')

const router = express.Router()

router.post('/register', asyncHandler(register))
router.post('/login', asyncHandler(login))
router.get('/me', authMiddleware, asyncHandler(me))

module.exports = router
