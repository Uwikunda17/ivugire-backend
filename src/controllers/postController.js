const { randomUUID } = require('crypto')
const path = require('path')
const fs = require('fs/promises')
const { spawn } = require('child_process')
const { pool } = require('../db/pool')

function getMediaType(mimeType) {
  if (mimeType?.startsWith('image/')) return 'image'
  if (mimeType?.startsWith('video/')) return 'video'
  if (mimeType?.startsWith('audio/')) return 'audio'
  return null
}

function getMediaTypeFromFilename(filename) {
  const extension = path.extname(filename || '').toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(extension)) return 'image'
  if (['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'].includes(extension)) return 'video'
  if (['.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac'].includes(extension)) return 'audio'
  return null
}

async function trimVideoFileIfPossible(filePath, seconds) {
  const parsed = path.parse(filePath)
  const trimmedPath = path.join(parsed.dir, `${parsed.name}_trimmed${parsed.ext}`)

  const trimmed = await new Promise((resolve) => {
    const ffmpeg = spawn(
      'ffmpeg',
      ['-y', '-i', filePath, '-t', String(seconds), '-c', 'copy', trimmedPath],
      { stdio: 'ignore' },
    )
    ffmpeg.on('error', () => resolve(false))
    ffmpeg.on('close', (code) => resolve(code === 0))
  })

  if (!trimmed) return null
  await fs.unlink(filePath).catch(() => {})
  return path.basename(trimmedPath)
}

function feedQuery(extraWhere = '') {
  return `
    SELECT
      p.id,
      p.caption,
      p.media_url AS "mediaUrl",
      p.media_type AS "mediaType",
      p.media_duration_seconds AS "mediaDurationSeconds",
      p.trim_end_seconds AS "trimEndSeconds",
      p.is_trimmed AS "isTrimmed",
      p.post_kind AS "postKind",
      p.created_at AS "createdAt",
      u.id AS "authorId",
      u.name AS "authorName",
      u.username AS "authorUsername",
      u.email AS "authorEmail",
      u.avatar_url AS "authorAvatarUrl",
      COALESCE(like_counts.count, 0) AS "likeCount",
      COALESCE(comment_counts.count, 0) AS "commentCount",
      COALESCE(share_counts.count, 0) AS "shareCount",
      COALESCE(view_counts.count, 0) AS "viewerCount",
      EXISTS (
        SELECT 1
        FROM post_likes pl
        WHERE pl.post_id = p.id AND pl.user_id = $1
      ) AS "likedByMe",
      COALESCE(json_agg(
        json_build_object(
          'id', pmi.id,
          'mediaUrl', pmi.media_url,
          'mediaType', pmi.media_type,
          'mediaDurationSeconds', pmi.media_duration_seconds,
          'trimEndSeconds', pmi.trim_end_seconds,
          'isTrimmed', pmi.is_trimmed,
          'sequenceOrder', pmi.sequence_order
        ) ORDER BY pmi.sequence_order
      ) FILTER (WHERE pmi.id IS NOT NULL), '[]') AS "mediaItems"
    FROM posts p
    INNER JOIN users u ON u.id = p.user_id
    LEFT JOIN post_media_items pmi ON pmi.post_id = p.id
    LEFT JOIN (
      SELECT post_id, COUNT(*)::INT AS count
      FROM post_likes
      GROUP BY post_id
    ) like_counts ON like_counts.post_id = p.id
    LEFT JOIN (
      SELECT post_id, COUNT(*)::INT AS count
      FROM post_comments
      GROUP BY post_id
    ) comment_counts ON comment_counts.post_id = p.id
    LEFT JOIN (
      SELECT post_id, COUNT(*)::INT AS count
      FROM post_shares
      GROUP BY post_id
    ) share_counts ON share_counts.post_id = p.id
    LEFT JOIN (
      SELECT post_id, COUNT(*)::INT AS count
      FROM post_views
      GROUP BY post_id
    ) view_counts ON view_counts.post_id = p.id
    ${extraWhere}
    GROUP BY p.id, u.id, like_counts.count, comment_counts.count, share_counts.count, view_counts.count
  `
}

async function markViews(userId, rows) {
  const values = rows
    .filter((row) => row.authorId !== userId)
    .map((row) => `('${row.id}', '${userId}')`)
  if (values.length === 0) return

  await pool.query(
    `INSERT INTO post_views (post_id, user_id)
     VALUES ${values.join(',')}
     ON CONFLICT (post_id, user_id)
     DO UPDATE SET viewed_at = NOW()`,
  )
}

async function listFeed(req, res) {
  const result = await pool.query(
    `${feedQuery()}
     ORDER BY p.created_at DESC
     LIMIT 100`,
    [req.user.id],
  )

  await markViews(req.user.id, result.rows)
  return res.json(result.rows)
}

async function listReels(req, res) {
  const result = await pool.query(
    `${feedQuery(`WHERE p.post_kind = 'reel' AND p.media_type = 'video'`)}
     ORDER BY p.created_at DESC
     LIMIT 100`,
    [req.user.id],
  )

  await markViews(req.user.id, result.rows)
  return res.json(result.rows)
}

async function listMyPosts(req, res) {
  const result = await pool.query(
    `${feedQuery('WHERE p.user_id = $1')}
     ORDER BY p.created_at DESC`,
    [req.user.id],
  )
  return res.json(result.rows)
}

async function createPost(req, res) {
  const { caption = '', postKind = 'post' } = req.body || {}
  const files = req.files || []

  if (!files || files.length === 0) return res.status(400).json({ error: 'media_file_required' })

  // Validate file counts
  const photoCount = files.filter((f) => {
    const mediaType = getMediaType(f.mimetype) || getMediaTypeFromFilename(f.originalname || f.filename)
    return mediaType === 'image'
  }).length
  const videoCount = files.filter((f) => {
    const mediaType = getMediaType(f.mimetype) || getMediaTypeFromFilename(f.originalname || f.filename)
    return mediaType === 'video'
  }).length

  if (photoCount > 10) return res.status(400).json({ error: 'max_photos_exceeded', max: 10 })
  if (videoCount > 3) return res.status(400).json({ error: 'max_videos_exceeded', max: 3 })

  // Validate media types
  let hasVideo = false
  let hasNonVideo = false
  
  for (const file of files) {
    const mediaType = getMediaType(file.mimetype) || getMediaTypeFromFilename(file.originalname || file.filename)
    if (!mediaType) return res.status(400).json({ error: 'unsupported_media_type' })
    if (mediaType === 'video' || mediaType === 'audio') hasVideo = true
    else hasNonVideo = true
  }

  if (postKind === 'reel' && hasNonVideo) {
    return res.status(400).json({ error: 'reels_require_video' })
  }

  const postId = randomUUID()
  const maxReelSeconds = 300
  let isTrimmed = false

  // Extract duration data from request body
  const durationData = req.body || {}
  
  try {
    // Insert post first
    await pool.query(
      `INSERT INTO posts (
        id,
        user_id,
        post_kind,
        caption,
        media_url,
        media_type,
        media_duration_seconds,
        trim_end_seconds,
        is_trimmed
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        postId,
        req.user.id,
        postKind === 'reel' ? 'reel' : 'post',
        caption,
        `/uploads/${files[0].filename}`, // Primary media for backwards compatibility
        getMediaType(files[0].mimetype) || getMediaTypeFromFilename(files[0].originalname || files[0].filename),
        null,
        null,
        false,
      ],
    )

    // Insert each media item
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const mediaType = getMediaType(file.mimetype) || getMediaTypeFromFilename(file.originalname || file.filename)
      const durationKey = `mediaDurationSeconds`
      const duration = Number(durationData[durationKey] || 0)
      const hasDuration = Number.isFinite(duration) && duration > 0
      const shouldTrim = mediaType === 'video' && hasDuration && duration > maxReelSeconds

      let storedFilename = file.filename

      if (shouldTrim) {
        const trimmedFilename = await trimVideoFileIfPossible(file.path, maxReelSeconds)
        if (trimmedFilename) {
          storedFilename = trimmedFilename
          isTrimmed = true
        }
      }

      await pool.query(
        `INSERT INTO post_media_items (
          id,
          post_id,
          media_url,
          media_type,
          media_duration_seconds,
          trim_end_seconds,
          is_trimmed,
          sequence_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          postId,
          `/uploads/${storedFilename}`,
          mediaType,
          hasDuration ? Math.round(duration) : null,
          shouldTrim ? maxReelSeconds : null,
          shouldTrim,
          i + 1,
        ],
      )
    }

    const result = await pool.query(
      `SELECT
        id,
        caption,
        media_url AS "mediaUrl",
        media_type AS "mediaType",
        media_duration_seconds AS "mediaDurationSeconds",
        trim_end_seconds AS "trimEndSeconds",
        is_trimmed AS "isTrimmed",
        post_kind AS "postKind",
        created_at AS "createdAt"
      FROM posts WHERE id = $1`,
      [postId],
    )

    return res.status(201).json({ ...result.rows[0], mediaCount: files.length, isTrimmed })
  } catch (error) {
    // Clean up uploads if insertion fails
    for (const file of files) {
      try {
        await fs.unlink(file.path)
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    throw error
  }
}

async function deletePost(req, res) {
  const { postId } = req.params
  const result = await pool.query('DELETE FROM posts WHERE id = $1 AND user_id = $2 RETURNING id', [
    postId,
    req.user.id,
  ])
  if (result.rowCount === 0) return res.status(404).json({ error: 'post_not_found_or_forbidden' })
  return res.json({ deleted: true, postId: result.rows[0].id })
}

async function toggleLike(req, res) {
  const { postId } = req.params
  const existing = await pool.query(
    'SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2',
    [postId, req.user.id],
  )

  // Get post owner
  const postOwner = await pool.query('SELECT user_id FROM posts WHERE id = $1', [postId])
  if (postOwner.rowCount > 0) {
    const ownerId = postOwner.rows[0].user_id

    if (existing.rowCount > 0) {
      // Unlike
      await pool.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [postId, req.user.id])
    } else {
      // Like - create notification if it's not the post owner liking their own post
      await pool.query(
        'INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT (post_id, user_id) DO NOTHING',
        [postId, req.user.id],
      )

      if (req.user.id !== ownerId) {
        const { createNotification } = require('./notificationController')
        await createNotification(ownerId, req.user.id, 'like', {
          relatedPostId: postId,
          text: `liked your post`,
        })

        // Emit real-time notification
        const io = req.app.get('io')
        if (io) {
          io.to(`user:${ownerId}`).emit('notification', {
            type: 'like',
            actorId: req.user.id,
            postId: postId,
          })
        }
      }
    }
  }

  const countResult = await pool.query(
    'SELECT COUNT(*)::INT AS count FROM post_likes WHERE post_id = $1',
    [postId],
  )
  return res.json({
    liked: existing.rowCount === 0,
    likeCount: countResult.rows[0].count,
  })
}

async function sharePost(req, res) {
  const { postId } = req.params
  await pool.query('INSERT INTO post_shares (id, post_id, user_id) VALUES ($1, $2, $3)', [
    randomUUID(),
    postId,
    req.user.id,
  ])
  const countResult = await pool.query(
    'SELECT COUNT(*)::INT AS count FROM post_shares WHERE post_id = $1',
    [postId],
  )
  return res.status(201).json({ shareCount: countResult.rows[0].count })
}

async function listComments(req, res) {
  const { postId } = req.params
  const result = await pool.query(
    `SELECT
      c.id,
      c.body,
      c.created_at AS "createdAt",
      u.id AS "userId",
      u.name AS "userName",
      u.username AS "username",
      u.avatar_url AS "avatarUrl"
    FROM post_comments c
    INNER JOIN users u ON u.id = c.user_id
    WHERE c.post_id = $1
    ORDER BY c.created_at ASC`,
    [postId],
  )
  return res.json(result.rows)
}

async function addComment(req, res) {
  const { postId } = req.params
  const { body } = req.body || {}
  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return res.status(400).json({ error: 'comment_body_required' })
  }

  const result = await pool.query(
    `INSERT INTO post_comments (id, post_id, user_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, body, created_at AS "createdAt"`,
    [randomUUID(), postId, req.user.id, body.trim()],
  )

  const countResult = await pool.query(
    'SELECT COUNT(*)::INT AS count FROM post_comments WHERE post_id = $1',
    [postId],
  )

  return res.status(201).json({
    ...result.rows[0],
    commentCount: countResult.rows[0].count,
  })
}

module.exports = {
  listFeed,
  listReels,
  listMyPosts,
  createPost,
  deletePost,
  toggleLike,
  sharePost,
  listComments,
  addComment,
}
