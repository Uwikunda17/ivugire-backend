const { pool } = require('../db/pool')

async function getProfile(req, res) {
  const result = await pool.query(
    `SELECT id, email, name, username, bio, location, website, avatar_url AS "avatarUrl", created_at AS "createdAt"
     FROM users
     WHERE id = $1`,
    [req.user.id],
  )
  if (result.rowCount === 0) return res.status(404).json({ error: 'user_not_found' })
  return res.json(result.rows[0])
}

async function updateProfile(req, res) {
  const { name, username, bio, location, website, avatarUrl } = req.body || {}
  if (!name || !username) {
    return res.status(400).json({ error: 'name_and_username_required' })
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET
         name = $1,
         username = $2,
         bio = $3,
         location = $4,
         website = $5,
         avatar_url = $6,
         updated_at = NOW()
       WHERE id = $7
       RETURNING id, email, name, username, bio, location, website, avatar_url AS "avatarUrl", created_at AS "createdAt"`,
      [name, username, bio || null, location || null, website || null, avatarUrl || null, req.user.id],
    )

    if (result.rowCount === 0) return res.status(404).json({ error: 'user_not_found' })
    return res.json(result.rows[0])
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ error: 'username_taken' })
    throw error
  }
}

module.exports = { getProfile, updateProfile }
