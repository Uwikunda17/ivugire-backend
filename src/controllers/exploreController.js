const { pool } = require('../db/pool')

// Search users by name, username, or bio
async function exploreSearch(req, res) {
  const { q: query = '', limit = 20 } = req.query
  const currentUserId = req.user?.id
  const searchQuery = `%${query.toLowerCase()}%`
  const queryLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100)

  const result = await pool.query(
    `SELECT 
      u.id,
      u.name,
      u.username,
      u.bio,
      u.avatar_url AS "avatarUrl",
      u.email,
      (SELECT COUNT(*) FROM follows WHERE following_id = u.id)::INT AS "followerCount",
      COALESCE(EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = u.id), false) AS "isFollowing"
    FROM users u
    WHERE (LOWER(u.name) LIKE $1 
      OR LOWER(u.username) LIKE $1 
      OR LOWER(u.bio) LIKE $1)
      AND u.id != $2
    ORDER BY 
      CASE WHEN LOWER(u.username) = LOWER($3) THEN 0 ELSE 1 END,
      (SELECT COUNT(*) FROM follows WHERE following_id = u.id) DESC,
      u.created_at DESC
    LIMIT $4`,
    [searchQuery, currentUserId || '', query.toLowerCase(), queryLimit],
  )

  return res.json(result.rows)
}

// Get trending users or hashtags
async function exploreTrending(req, res) {
  const { type = 'users', limit = 10 } = req.query
  const currentUserId = req.user?.id
  const queryLimit = Math.min(Math.max(1, parseInt(limit, 10) || 10), 100)

  if (type === 'hashtags') {
    // Get trending hashtags - simplified version
    const result = await pool.query(
      `WITH hashtag_matches AS (
        SELECT 
          (regexp_matches(COALESCE(body, ''), '#[a-zA-Z0-9_]+', 'g'))[1] as tag,
          post_id
        FROM posts
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND body ~* '#[a-zA-Z0-9_]+'
      )
      SELECT 
        tag,
        COUNT(DISTINCT post_id) as "count"
      FROM hashtag_matches
      WHERE tag IS NOT NULL
      GROUP BY tag
      ORDER BY COUNT(DISTINCT post_id) DESC
      LIMIT $1`,
      [queryLimit],
    )

    return res.json(
      result.rows.map((row) => ({
        tag: row.tag,
        count: row.count,
      })),
    )
  }

  // Get trending users (default)
  const result = await pool.query(
    `SELECT 
      u.id,
      u.name,
      u.username,
      u.bio,
      u.avatar_url AS "avatarUrl",
      (SELECT COUNT(*) FROM follows WHERE following_id = u.id)::INT AS "followerCount",
      COALESCE(EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = u.id), false) AS "isFollowing"
    FROM users u
    WHERE u.id != $2
    ORDER BY (SELECT COUNT(*) FROM follows WHERE following_id = u.id) DESC,
      u.created_at DESC
    LIMIT $1`,
    [queryLimit, currentUserId || ''],
  )

  return res.json(result.rows)
}

module.exports = { exploreSearch, exploreTrending }
