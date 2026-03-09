const { randomUUID } = require('crypto')
const path = require('path')
const fs = require('fs/promises')
const { spawn } = require('child_process')
const { pool } = require('../db/pool')

const MAX_STORY_VIDEO_SECONDS = 300
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_ANIMATIONS = new Set(['none', 'pulse', 'float', 'glow', 'wave'])
const ALLOWED_MEDIA_FILTERS = new Set(['none', 'grayscale', 'warm', 'cool', 'vivid'])
const ALLOWED_WORD_FILTERS = new Set(['none', 'mild', 'strict'])
const BLOCKED_WORDS = ['idiot', 'stupid', 'hate', 'kill', 'trash']

function normalizePreset(value, allowed, fallback = 'none') {
  const candidate = String(value || fallback).toLowerCase().trim()
  if (!allowed.has(candidate)) return fallback
  return candidate
}

function parseTaggedUserIds(rawValue) {
  if (!rawValue) return []

  let list = []
  if (Array.isArray(rawValue)) {
    list = rawValue
  } else if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) list = parsed
      } catch (_error) {
        list = trimmed.split(',')
      }
    } else {
      list = trimmed.split(',')
    }
  }

  const normalized = list
    .map((value) => String(value || '').trim())
    .filter((value) => UUID_PATTERN.test(value))

  return [...new Set(normalized)]
}

function applyWordFilter(inputCaption, level) {
  const caption = String(inputCaption || '')
  if (level === 'none') return caption
  if (!caption.trim()) return caption

  let filtered = caption
  for (const word of BLOCKED_WORDS) {
    const pattern = new RegExp(`\\b${word}\\b`, 'gi')
    const replacement = level === 'strict' ? '[filtered]' : '*'.repeat(word.length)
    filtered = filtered.replace(pattern, replacement)
  }
  return filtered
}

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

function storiesSelect(whereClause = '') {
  return `
    SELECT
      s.id,
      s.caption,
      s.media_url AS "mediaUrl",
      s.media_type AS "mediaType",
      s.media_duration_seconds AS "mediaDurationSeconds",
      s.trim_end_seconds AS "trimEndSeconds",
      s.is_trimmed AS "isTrimmed",
      s.sticker_text AS "stickerText",
      s.animation_preset AS "animationPreset",
      s.media_filter AS "mediaFilter",
      s.word_filter_level AS "wordFilterLevel",
      s.created_at AS "createdAt",
      s.expires_at AS "expiresAt",
      u.id AS "authorId",
      u.name AS "authorName",
      u.username AS "authorUsername",
      u.avatar_url AS "authorAvatarUrl",
      s.repost_from_story_id AS "repostFromStoryId",
      source_user.id AS "repostFromUserId",
      source_user.name AS "repostFromUserName",
      source_user.username AS "repostFromUserUsername",
      source_user.avatar_url AS "repostFromUserAvatarUrl",
      COALESCE(view_counts.count, 0) AS "viewerCount",
      EXISTS (
        SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.user_id = $1
      ) AS "viewedByMe",
      COALESCE(tagged.tagged_users, '[]'::json) AS "taggedUsers"
    FROM stories s
    INNER JOIN users u ON u.id = s.user_id
    LEFT JOIN stories source_story ON source_story.id = s.repost_from_story_id
    LEFT JOIN users source_user ON source_user.id = source_story.user_id
    LEFT JOIN (
      SELECT story_id, COUNT(*)::INT AS count
      FROM story_views
      GROUP BY story_id
    ) view_counts ON view_counts.story_id = s.id
    LEFT JOIN LATERAL (
      SELECT
        json_agg(
          json_build_object(
            'id', tu.id,
            'name', tu.name,
            'username', tu.username,
            'avatarUrl', tu.avatar_url
          )
          ORDER BY tu.name
        ) AS tagged_users
      FROM story_tags st
      INNER JOIN users tu ON tu.id = st.user_id
      WHERE st.story_id = s.id
    ) tagged ON true
    ${whereClause}
  `
}

async function insertStoryTags(client, storyId, taggedUserIds, actorId) {
  if (!Array.isArray(taggedUserIds) || taggedUserIds.length === 0) return
  await client.query(
    `INSERT INTO story_tags (story_id, user_id)
     SELECT $1, u.id
     FROM users u
     WHERE u.id = ANY($2::uuid[]) AND u.id <> $3
     ON CONFLICT (story_id, user_id) DO NOTHING`,
    [storyId, taggedUserIds, actorId],
  )
}

async function getStoryById(storyId, viewerUserId) {
  const result = await pool.query(
    `${storiesSelect('WHERE s.id = $2')}
     LIMIT 1`,
    [viewerUserId, storyId],
  )
  return result.rows[0] || null
}

async function createStory(req, res) {
  const file = req.file
  const rawCaption = String(req.body?.caption || '')
  if (!file) return res.status(400).json({ error: 'media_file_required' })

  const mediaType = getMediaType(file.mimetype) || getMediaTypeFromFilename(file.originalname || file.filename)
  if (!mediaType) return res.status(400).json({ error: 'unsupported_media_type' })

  const animationPreset = normalizePreset(req.body?.animationPreset, ALLOWED_ANIMATIONS)
  const mediaFilter = normalizePreset(req.body?.mediaFilter, ALLOWED_MEDIA_FILTERS)
  const wordFilterLevel = normalizePreset(req.body?.wordFilterLevel, ALLOWED_WORD_FILTERS)
  const caption = applyWordFilter(rawCaption, wordFilterLevel)
  const stickerText = String(req.body?.stickerText || '').trim().slice(0, 60)
  const taggedUserIds = parseTaggedUserIds(req.body?.taggedUserIds)

  const duration = Number(req.body?.mediaDurationSeconds || 0)
  const hasDuration = Number.isFinite(duration) && duration > 0
  const shouldTrim = mediaType === 'video' && hasDuration && duration > MAX_STORY_VIDEO_SECONDS
  let storedFilename = file.filename

  if (shouldTrim) {
    const trimmedFilename = await trimVideoFileIfPossible(file.path, MAX_STORY_VIDEO_SECONDS)
    if (trimmedFilename) storedFilename = trimmedFilename
  }

  const storyId = randomUUID()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO stories (
        id,
        user_id,
        caption,
        media_url,
        media_type,
        media_duration_seconds,
        trim_end_seconds,
        is_trimmed,
        sticker_text,
        animation_preset,
        media_filter,
        word_filter_level
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        storyId,
        req.user.id,
        caption,
        `/uploads/${storedFilename}`,
        mediaType,
        hasDuration ? Math.round(duration) : null,
        shouldTrim ? MAX_STORY_VIDEO_SECONDS : null,
        shouldTrim,
        stickerText || null,
        animationPreset,
        mediaFilter,
        wordFilterLevel,
      ],
    )
    await insertStoryTags(client, storyId, taggedUserIds, req.user.id)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  const story = await getStoryById(storyId, req.user.id)
  return res.status(201).json(story)
}

async function repostStory(req, res) {
  const { storyId } = req.params
  const sourceResult = await pool.query(
    `SELECT
      id,
      caption,
      media_url,
      media_type,
      media_duration_seconds,
      trim_end_seconds,
      is_trimmed,
      sticker_text,
      animation_preset,
      media_filter,
      word_filter_level
    FROM stories
    WHERE id = $1`,
    [storyId],
  )
  if (sourceResult.rowCount === 0) return res.status(404).json({ error: 'story_not_found' })

  const source = sourceResult.rows[0]
  const rawCaption = String(req.body?.caption || source.caption || '')
  const animationPreset = normalizePreset(req.body?.animationPreset || source.animation_preset, ALLOWED_ANIMATIONS)
  const mediaFilter = normalizePreset(req.body?.mediaFilter || source.media_filter, ALLOWED_MEDIA_FILTERS)
  const wordFilterLevel = normalizePreset(req.body?.wordFilterLevel || source.word_filter_level, ALLOWED_WORD_FILTERS)
  const caption = applyWordFilter(rawCaption, wordFilterLevel)
  const stickerText = String(req.body?.stickerText || source.sticker_text || '').trim().slice(0, 60)
  const taggedUserIds = parseTaggedUserIds(req.body?.taggedUserIds)

  const repostedStoryId = randomUUID()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO stories (
        id,
        user_id,
        caption,
        media_url,
        media_type,
        media_duration_seconds,
        trim_end_seconds,
        is_trimmed,
        sticker_text,
        animation_preset,
        media_filter,
        word_filter_level,
        repost_from_story_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        repostedStoryId,
        req.user.id,
        caption,
        source.media_url,
        source.media_type,
        source.media_duration_seconds,
        source.trim_end_seconds,
        source.is_trimmed,
        stickerText || null,
        animationPreset,
        mediaFilter,
        wordFilterLevel,
        source.id,
      ],
    )
    await insertStoryTags(client, repostedStoryId, taggedUserIds, req.user.id)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  const story = await getStoryById(repostedStoryId, req.user.id)
  return res.status(201).json(story)
}

async function listActiveStories(req, res) {
  const result = await pool.query(
    `${storiesSelect('WHERE s.expires_at > NOW()')}
     ORDER BY s.created_at DESC`,
    [req.user.id],
  )
  return res.json(result.rows)
}

async function listMyStories(req, res) {
  const scope = String(req.query.scope || 'active')
  const archived = scope === 'archived'
  const condition = archived ? 's.expires_at <= NOW()' : 's.expires_at > NOW()'

  const result = await pool.query(
    `${storiesSelect(`WHERE s.user_id = $2 AND ${condition}`)}
     ORDER BY s.created_at DESC`,
    [req.user.id, req.user.id],
  )

  return res.json(result.rows)
}

async function viewStory(req, res) {
  const { storyId } = req.params
  const storyCheck = await pool.query('SELECT user_id, expires_at FROM stories WHERE id = $1', [storyId])
  if (storyCheck.rowCount === 0) return res.status(404).json({ error: 'story_not_found' })

  const expiresAt = new Date(storyCheck.rows[0].expires_at)
  if (expiresAt.getTime() <= Date.now()) {
    return res.status(410).json({ error: 'story_expired' })
  }

  const ownerId = storyCheck.rows[0].user_id
  if (ownerId !== req.user.id) {
    await pool.query(
      `INSERT INTO story_views (story_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (story_id, user_id)
       DO UPDATE SET viewed_at = NOW()`,
      [storyId, req.user.id],
    )
  }

  return res.json({ viewed: true })
}

async function listStoryViewers(req, res) {
  const { storyId } = req.params
  const owner = await pool.query('SELECT user_id FROM stories WHERE id = $1', [storyId])
  if (owner.rowCount === 0) return res.status(404).json({ error: 'story_not_found' })
  if (owner.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'forbidden_story' })

  const result = await pool.query(
    `SELECT
      sv.viewed_at AS "viewedAt",
      u.id,
      u.name,
      u.username,
      u.email,
      u.avatar_url AS "avatarUrl"
    FROM story_views sv
    INNER JOIN users u ON u.id = sv.user_id
    WHERE sv.story_id = $1
    ORDER BY sv.viewed_at DESC`,
    [storyId],
  )
  return res.json(result.rows)
}

module.exports = {
  createStory,
  repostStory,
  listActiveStories,
  listMyStories,
  viewStory,
  listStoryViewers,
}
