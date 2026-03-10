const express = require('express')
const authRoutes = require('./authRoutes')
const postRoutes = require('./postRoutes')
const profileRoutes = require('./profileRoutes')
const chatRoutes = require('./chatRoutes')
const storyRoutes = require('./storyRoutes')
const socialRoutes = require('./socialRoutes')
const notificationRoutes = require('./notificationRoutes')
const exploreRoutes = require('./exploreRoutes')

const router = express.Router()

router.use('/auth', authRoutes)
router.use(postRoutes)
router.use(profileRoutes)
router.use(chatRoutes)
router.use(storyRoutes)
router.use(socialRoutes)
router.use(notificationRoutes)
router.use(exploreRoutes)

module.exports = router
