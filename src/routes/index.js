const express = require('express')
const authRoutes = require('./authRoutes')
const postRoutes = require('./postRoutes')
const profileRoutes = require('./profileRoutes')
const chatRoutes = require('./chatRoutes')
const storyRoutes = require('./storyRoutes')

const router = express.Router()

router.use('/auth', authRoutes)
router.use(postRoutes)
router.use(profileRoutes)
router.use(chatRoutes)
router.use(storyRoutes)

module.exports = router
