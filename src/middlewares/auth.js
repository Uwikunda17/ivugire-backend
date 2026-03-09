const jwt = require('jsonwebtoken')

function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header) return res.status(401).json({ error: 'missing_auth' })

  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'invalid_auth_header' })

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret')
    return next()
  } catch (_error) {
    return res.status(401).json({ error: 'invalid_token' })
  }
}

module.exports = { authMiddleware }
