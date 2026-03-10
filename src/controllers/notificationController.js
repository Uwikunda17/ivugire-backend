const { randomUUID } = require('crypto')
const { pool } = require('../db/pool')

// Get all notifications for user
async function getNotifications(req, res) {
  const { limit = 20, offset = 0, unreadOnly = false } = req.query

  let query = `SELECT 
    n.id,
    n.notification_type AS "notificationType",
    n.is_read AS "isRead",
    n.created_at AS "createdAt",
    n.text,
    n.related_post_id AS "relatedPostId",
    n.related_story_id AS "relatedStoryId",
    n.related_chat_id AS "relatedChatId",
    actor.id AS "actorId",
    actor.name AS "actorName",
    actor.username AS "actorUsername",
    actor.avatar_url AS "actorAvatarUrl"
  FROM notifications n
  INNER JOIN users actor ON actor.id = n.actor_id
  WHERE n.user_id = $1`

  const params = [req.user.id]
  let paramIndex = 2

  if (unreadOnly === 'true') {
    query += ` AND n.is_read = false`
  }

  query += ` ORDER BY n.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
  params.push(limit, offset)

  const result = await pool.query(query, params)
  return res.json(result.rows)
}

// Get unread notification count
async function getUnreadCount(req, res) {
  const result = await pool.query(
    'SELECT COUNT(*)::INT AS unread FROM notifications WHERE user_id = $1 AND is_read = false',
    [req.user.id],
  )
  return res.json({ unread: result.rows[0].unread })
}

// Mark notification as read
async function markAsRead(req, res) {
  const { notificationId } = req.params

  await pool.query(
    'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
    [notificationId, req.user.id],
  )

  return res.json({ status: 'read' })
}

// Mark all notifications as read
async function markAllAsRead(req, res) {
  await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [req.user.id])

  return res.json({ status: 'all_read' })
}

// Delete notification
async function deleteNotification(req, res) {
  const { notificationId } = req.params

  await pool.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [notificationId, req.user.id])

  return res.json({ status: 'deleted' })
}

// Create notification (internal function)
async function createNotification(userId, actorId, notificationType, options = {}) {
  const notificationId = randomUUID()

  await pool.query(
    `INSERT INTO notifications (id, user_id, actor_id, notification_type, related_post_id, related_story_id, related_chat_id, text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      notificationId,
      userId,
      actorId,
      notificationType,
      options.relatedPostId || null,
      options.relatedStoryId || null,
      options.relatedChatId || null,
      options.text || null,
    ],
  )

  return notificationId
}

// Search for users in Explore
async function searchExplore(req, res) {
  const { q = '', limit = 20 } = req.query
  const currentUserId = req.user.id

  if (!q || q.trim().length === 0) {
    // Return suggested users (random users you're not following)
    const result = await pool.query(
      `SELECT u.id, u.name, u.username, u.bio, u.avatar_url AS "avatarUrl", u.email,
        EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = u.id) AS "isFollowing",
        (SELECT COUNT(*)::INT FROM follows WHERE following_id = u.id) AS "followerCount"
       FROM users u
       WHERE u.id != $1 AND NOT EXISTS(
         SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = u.id
       )
       ORDER BY (SELECT COUNT(*) FROM follows WHERE following_id = u.id) DESC
       LIMIT $2`,
      [currentUserId, limit],
    )
    return res.json(result.rows)
  }

  // Search by name, username, or email
  const search = `%${q.toLowerCase()}%`
  const result = await pool.query(
    `SELECT u.id, u.name, u.username, u.bio, u.avatar_url AS "avatarUrl", u.email,
      EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = u.id) AS "isFollowing",
      (SELECT COUNT(*)::INT FROM follows WHERE following_id = u.id) AS "followerCount",
      CASE 
        WHEN LOWER(u.username) LIKE $3 THEN 0
        WHEN LOWER(u.name) LIKE $3 THEN 1
        ELSE 2
      END AS relevance
     FROM users u
     WHERE u.id != $1 AND (
       LOWER(u.username) LIKE $3 OR 
       LOWER(u.name) LIKE $3 OR 
       LOWER(u.email) LIKE $3
     )
     ORDER BY relevance, (SELECT COUNT(*) FROM follows WHERE following_id = u.id) DESC
     LIMIT $2`,
    [currentUserId, limit, search],
  )

  return res.json(result.rows)
}

// Get trending users/hashtags
async function getTrending(req, res) {
  const { type = 'users', limit = 10 } = req.query
  const currentUserId = req.user.id

  if (type === 'users') {
    // Get most followed users
    const result = await pool.query(
      `SELECT u.id, u.name, u.username, u.bio, u.avatar_url AS "avatarUrl",
        (SELECT COUNT(*)::INT FROM follows WHERE following_id = u.id) AS "followerCount",
        EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = u.id) AS "isFollowing"
       FROM users u
       WHERE u.id != $1
       ORDER BY (SELECT COUNT(*) FROM follows WHERE following_id = u.id) DESC
       LIMIT $2`,
      [currentUserId, limit],
    )
    return res.json(result.rows)
  }

  if (type === 'hashtags') {
    // Extract hashtags from posts
    const result = await pool.query(
      `SELECT 
        hashtags.tag,
        COUNT(*)::INT AS count
       FROM (
         SELECT regexp_matches(caption, '#\w+', 'g') AS hashtag FROM posts
         WHERE created_at > NOW() - INTERVAL '7 days'
       ) tags(hashtag),
       LATERAL (
         SELECT LOWER(tags.hashtag[1]) AS tag
       ) hashtags
       GROUP BY hashtags.tag
       ORDER BY count DESC
       LIMIT $1`,
      [limit],
    )
    return res.json(
      result.rows.map((row) => ({
        tag: row.tag,
        count: row.count,
      })),
    )
  }

  return res.json([])
}

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  createNotification,
  searchExplore,
  getTrending,
}
