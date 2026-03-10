const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const { randomUUID } = require('crypto')
const { pool } = require('../db/pool')

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET || 'dev-secret',
    { expiresIn: '7d' },
  )
}

async function register(req, res) {
  const { email, password, name } = req.body || {}
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'name_email_password_required' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password_too_short' })
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email])
  if (existing.rowCount > 0) return res.status(400).json({ error: 'email_taken' })

  const id = randomUUID()
  const usernameBase = email.split('@')[0].toLowerCase()
  const username = `${usernameBase}_${id.slice(0, 6)}`
  const passwordHash = await bcrypt.hash(password, 10)

  const insert = await pool.query(
    `INSERT INTO users (id, email, password_hash, name, username)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING
      id,
      email,
      name,
      username,
      bio,
      location,
      website,
      avatar_url AS "avatarUrl",
      created_at AS "createdAt"`,
    [id, email.toLowerCase(), passwordHash, name, username],
  )

  const user = insert.rows[0]
  const token = signToken(user)
  return res.status(201).json({ token, user })
}

async function login(req, res) {
  const { emailOrUsername, password } = req.body || {}
  if (!emailOrUsername || !password) return res.status(400).json({ error: 'emailOrUsername_password_required' })

  // Support both email and username login
  const result = await pool.query(
    `SELECT
      id,
      email,
      password_hash,
      name,
      username,
      bio,
      location,
      website,
      avatar_url AS "avatarUrl",
      created_at AS "createdAt"
     FROM users
     WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)`,
    [emailOrUsername],
  )
  if (result.rowCount === 0) return res.status(400).json({ error: 'invalid_credentials' })

  const user = result.rows[0]
  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return res.status(400).json({ error: 'invalid_credentials' })

  const token = signToken(user)
  const { password_hash: _removed, ...safeUser } = user
  return res.json({ token, user: safeUser })
}

async function me(req, res) {
  const result = await pool.query(
    `SELECT
      id,
      email,
      name,
      username,
      bio,
      location,
      website,
      avatar_url AS "avatarUrl",
      created_at AS "createdAt"
     FROM users
     WHERE id = $1`,
    [req.user.id],
  )
  if (result.rowCount === 0) return res.status(404).json({ error: 'user_not_found' })
  return res.json(result.rows[0])
}

module.exports = { register, login, me }
