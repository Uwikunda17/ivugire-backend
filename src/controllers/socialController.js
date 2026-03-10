const { randomUUID } = require('crypto')
const { pool } = require('../db/pool')

// Follow/Unfollow user
async function toggleFollow(req, res) {
  const { userId } = req.params
  const currentUserId = req.user.id

  if (userId === currentUserId) {
    return res.status(400).json({ error: 'cannot_follow_yourself' })
  }

  try {
    const followExists = await pool.query(
      'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
      [currentUserId, userId],
    )

    if (followExists.rowCount > 0) {
      // Unfollow
      await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [currentUserId, userId])
      return res.json({ following: false })
    } else {
      // Follow - create notification
      await pool.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [currentUserId, userId])

      // Create follow notification
      const notificationId = randomUUID()
      await pool.query(
        `INSERT INTO notifications (id, user_id, actor_id, notification_type, text)
         VALUES ($1, $2, $3, 'follow', 'started following you')`,
        [notificationId, userId, currentUserId],
      )

      // Emit real-time notification
      const io = req.app.get('io')
      if (io) {
        io.to(`user:${userId}`).emit('notification', {
          type: 'follow',
          actorId: currentUserId,
          notificationId: notificationId,
        })
      }

      return res.json({ following: true })
    }
  } catch (error) {
    throw error
  }
}

// Get follow status
async function getFollowStatus(req, res) {
  const { userId } = req.params
  const currentUserId = req.user.id

  const status = await pool.query(
    `SELECT 
      EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2) AS "isFollowing",
      EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = $1) AS "isFollowedBy"`,
    [currentUserId, userId],
  )

  const row = status.rows[0]
  return res.json({
    isFollowing: row.isFollowing,
    isFollowedBy: row.isFollowedBy,
    isMutualFollow: row.isFollowing && row.isFollowedBy,
  })
}

// Get user profile with follow stats
async function getUserProfile(req, res) {
  const { userId } = req.params
  const currentUserId = req.user.id

  const user = await pool.query(
    `SELECT 
      u.id, 
      u.email, 
      u.name, 
      u.username, 
      u.bio, 
      u.location, 
      u.website, 
      u.avatar_url AS "avatarUrl",
      u.created_at AS "createdAt",
      (SELECT COUNT(*) FROM follows WHERE following_id = u.id)::INT AS "followerCount",
      (SELECT COUNT(*) FROM follows WHERE follower_id = u.id)::INT AS "followingCount",
      EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = u.id) AS "isFollowing",
      EXISTS(SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = $2) AS "isFollowedBy"
    FROM users u
    WHERE u.id = $1`,
    [userId, currentUserId],
  )

  if (user.rowCount === 0) {
    return res.status(404).json({ error: 'user_not_found' })
  }

  const profile = user.rows[0]
  profile.isMutualFollow = profile.isFollowing && profile.isFollowedBy

  return res.json(profile)
}

// Get followers list
async function getFollowers(req, res) {
  const { userId } = req.params

  const followers = await pool.query(
    `SELECT u.id, u.name, u.username, u.avatar_url AS "avatarUrl", u.email
     FROM followers
     INNER JOIN users u ON u.id = followers.follower_id
     WHERE followers.following_id = $1
     ORDER BY followers.created_at DESC`,
    [userId],
  )

  return res.json(followers.rows)
}

// Get following list
async function getFollowing(req, res) {
  const { userId } = req.params

  const following = await pool.query(
    `SELECT u.id, u.name, u.username, u.avatar_url AS "avatarUrl", u.email
     FROM follows
     INNER JOIN users u ON u.id = follows.following_id
     WHERE follows.follower_id = $1
     ORDER BY follows.created_at DESC`,
    [userId],
  )

  return res.json(following.rows)
}

// Get message requests
async function getMessageRequests(req, res) {
  const requests = await pool.query(
    `SELECT 
      mr.id,
      mr.chat_id AS "chatId",
      mr.sender_id AS "senderId",
      sender.name AS "senderName",
      sender.username AS "senderUsername",
      sender.avatar_url AS "senderAvatarUrl",
      mr.message_count AS "messageCount",
      mr.status,
      mr.created_at AS "createdAt"
    FROM message_requests mr
    INNER JOIN users sender ON sender.id = mr.sender_id
    WHERE mr.recipient_id = $1 AND mr.status = 'pending'
    ORDER BY mr.created_at DESC`,
    [req.user.id],
  )

  return res.json(requests.rows)
}

// Accept message request
async function acceptMessageRequest(req, res) {
  const { requestId } = req.params

  const request = await pool.query(
    'SELECT * FROM message_requests WHERE id = $1 AND recipient_id = $2',
    [requestId, req.user.id],
  )

  if (request.rowCount === 0) {
    return res.status(404).json({ error: 'request_not_found' })
  }

  await pool.query('UPDATE message_requests SET status = $1, updated_at = NOW() WHERE id = $2', [
    'accepted',
    requestId,
  ])

  return res.json({ status: 'accepted' })
}

// Decline message request
async function declineMessageRequest(req, res) {
  const { requestId } = req.params

  const request = await pool.query(
    'SELECT * FROM message_requests WHERE id = $1 AND recipient_id = $2',
    [requestId, req.user.id],
  )

  if (request.rowCount === 0) {
    return res.status(404).json({ error: 'request_not_found' })
  }

  await pool.query('UPDATE message_requests SET status = $1, updated_at = NOW() WHERE id = $2', [
    'declined',
    requestId,
  ])

  return res.json({ status: 'declined' })
}

// Get active calls for user
async function getActiveCalls(req, res) {
  const calls = await pool.query(
    `SELECT 
      c.id,
      c.chat_id AS "chatId",
      c.initiator_id AS "initiatorId",
      initiator.name AS "initiatorName",
      initiator.username AS "initiatorUsername",
      initiator.avatar_url AS "initiatorAvatarUrl",
      c.recipient_id AS "recipientId",
      recipient.name AS "recipientName",
      recipient.username AS "recipientUsername",
      recipient.avatar_url AS "recipientAvatarUrl",
      c.call_type AS "callType",
      c.status,
      c.started_at AS "startedAt",
      c.created_at AS "createdAt"
    FROM calls c
    INNER JOIN users initiator ON initiator.id = c.initiator_id
    LEFT JOIN users recipient ON recipient.id = c.recipient_id
    WHERE (c.initiator_id = $1 OR c.recipient_id = $1) 
      AND c.status IN ('ringing', 'accepted')
    ORDER BY c.created_at DESC`,
    [req.user.id],
  )

  return res.json(calls.rows)
}

// Get call history
async function getCallHistory(req, res) {
  const { chatId } = req.params

  const history = await pool.query(
    `SELECT 
      c.id,
      c.initiator_id AS "initiatorId",
      initiator.name AS "initiatorName",
      c.recipient_id AS "recipientId",
      recipient.name AS "recipientName",
      c.call_type AS "callType",
      c.status,
      c.started_at AS "startedAt",
      c.ended_at AS "endedAt",
      c.duration_seconds AS "durationSeconds",
      c.created_at AS "createdAt"
    FROM calls c
    INNER JOIN users initiator ON initiator.id = c.initiator_id
    LEFT JOIN users recipient ON recipient.id = c.recipient_id
    WHERE c.chat_id = $1
    ORDER BY c.created_at DESC
    LIMIT 50`,
    [chatId],
  )

  return res.json(history.rows)
}

module.exports = {
  toggleFollow,
  getFollowStatus,
  getUserProfile,
  getFollowers,
  getFollowing,
  getMessageRequests,
  acceptMessageRequest,
  declineMessageRequest,
  getActiveCalls,
  getCallHistory,
}
