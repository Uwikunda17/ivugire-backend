const { randomUUID } = require('crypto')
const path = require('path')
const { pool } = require('../db/pool')

function mapAttachmentType(mimeType, originalName = '') {
  if (mimeType?.startsWith('image/')) return 'image'
  if (mimeType?.startsWith('video/')) return 'video'
  if (mimeType?.startsWith('audio/')) return 'audio'
  if (mimeType?.startsWith('application/') || mimeType?.startsWith('text/')) return 'document'

  const extension = path.extname(originalName).toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(extension)) return 'image'
  if (['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'].includes(extension)) return 'video'
  if (['.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac'].includes(extension)) return 'audio'
  if (
    ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.zip', '.rar'].includes(
      extension,
    )
  ) {
    return 'document'
  }

  return 'file'
}

function attachmentLabelSql(countExpression, fileTypeExpression, mediaTypeExpression, mediaUrlExpression) {
  return `CASE
    WHEN COALESCE(${countExpression}, 0) > 1 THEN CONCAT(${countExpression}, ' attachments')
    WHEN COALESCE(${countExpression}, 0) = 1 THEN
      CASE COALESCE(${fileTypeExpression}, ${mediaTypeExpression}, 'file')
        WHEN 'audio' THEN 'Voice message'
        WHEN 'image' THEN 'Photo'
        WHEN 'video' THEN 'Video'
        WHEN 'document' THEN 'Document'
        ELSE 'Attachment'
      END
    WHEN ${mediaUrlExpression} IS NOT NULL THEN
      CASE COALESCE(${mediaTypeExpression}, 'file')
        WHEN 'audio' THEN 'Voice message'
        WHEN 'image' THEN 'Photo'
        WHEN 'video' THEN 'Video'
        WHEN 'document' THEN 'Document'
        ELSE 'Attachment'
      END
    ELSE NULL
  END`
}

function shareLabelSql(shareTypeExpression) {
  return `CASE ${shareTypeExpression}
    WHEN 'post' THEN 'Shared post'
    WHEN 'reel' THEN 'Shared reel'
    WHEN 'story' THEN 'Shared story'
    ELSE NULL
  END`
}

function messagePreviewSql(bodyExpression, countExpression, fileTypeExpression, mediaTypeExpression, mediaUrlExpression, deletedExpression, shareTypeExpression) {
  return `CASE
    WHEN COALESCE(${deletedExpression}, false) THEN 'Message unsent'
    ELSE COALESCE(
      NULLIF(TRIM(${bodyExpression}), ''),
      ${shareLabelSql(shareTypeExpression)},
      ${attachmentLabelSql(countExpression, fileTypeExpression, mediaTypeExpression, mediaUrlExpression)}
    )
  END`
}

const MESSAGE_SELECT_SQL = `
  SELECT
    m.id,
    CASE WHEN m.is_deleted THEN '' ELSE m.body END AS body,
    m.sender_id AS "senderId",
    u.name AS "senderName",
    u.avatar_url AS "senderAvatarUrl",
    m.created_at AS "createdAt",
    m.is_deleted AS "isDeleted",
    m.deleted_at AS "deletedAt",
    reply_message.data AS "replyTo",
    shared_content.data AS "sharedContent",
    CASE
      WHEN m.is_deleted THEN '[]'::json
      ELSE COALESCE(
        attachments.data,
        CASE
          WHEN m.media_url IS NOT NULL THEN json_build_array(
            json_build_object(
              'id', ('legacy-' || m.id::text),
              'fileUrl', m.media_url,
              'fileType', COALESCE(m.media_type, 'file'),
              'fileName', regexp_replace(m.media_url, '^.*/', ''),
              'fileSize', 0
            )
          )
          ELSE '[]'::json
        END
      )
    END AS attachments,
    CASE
      WHEN m.is_deleted THEN '[]'::json
      ELSE COALESCE(reactions.data, '[]'::json)
    END AS reactions
  FROM messages m
  INNER JOIN users u ON u.id = m.sender_id
  LEFT JOIN LATERAL (
    SELECT json_agg(
      json_build_object(
        'id', a.id,
        'fileUrl', a.file_url,
        'fileType', a.file_type,
        'fileName', a.file_name,
        'fileSize', a.file_size
      )
      ORDER BY a.created_at
    ) AS data
    FROM message_attachments a
    WHERE a.message_id = m.id
  ) attachments ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'emoji', reaction_summary.emoji,
          'count', reaction_summary.count,
          'reactedByMe', reaction_summary."reactedByMe"
        )
        ORDER BY reaction_summary."lastCreatedAt" DESC, reaction_summary.emoji ASC
      ),
      '[]'::json
    ) AS data
    FROM (
      SELECT
        r.emoji,
        COUNT(*)::INT AS count,
        BOOL_OR(r.user_id = $2) AS "reactedByMe",
        MAX(r.created_at) AS "lastCreatedAt"
      FROM message_reactions r
      WHERE r.message_id = m.id
      GROUP BY r.emoji
    ) reaction_summary
  ) reactions ON true
  LEFT JOIN LATERAL (
    SELECT CASE
      WHEN ms.share_type IN ('post', 'reel') AND p.id IS NOT NULL THEN jsonb_build_object(
        'type', ms.share_type,
        'id', p.id,
        'title', CASE WHEN p.post_kind = 'reel' THEN 'Shared reel' ELSE 'Shared post' END,
        'caption', p.caption,
        'mediaUrl', p.media_url,
        'mediaType', p.media_type,
        'trimEndSeconds', p.trim_end_seconds,
        'isTrimmed', p.is_trimmed,
        'createdAt', p.created_at,
        'authorId', post_author.id,
        'authorName', post_author.name,
        'authorUsername', post_author.username,
        'authorAvatarUrl', post_author.avatar_url
      )
      WHEN ms.share_type = 'story' AND s.id IS NOT NULL THEN jsonb_build_object(
        'type', 'story',
        'id', s.id,
        'title', 'Shared story',
        'caption', s.caption,
        'mediaUrl', s.media_url,
        'mediaType', s.media_type,
        'trimEndSeconds', s.trim_end_seconds,
        'isTrimmed', s.is_trimmed,
        'createdAt', s.created_at,
        'expiresAt', s.expires_at,
        'authorId', story_author.id,
        'authorName', story_author.name,
        'authorUsername', story_author.username,
        'authorAvatarUrl', story_author.avatar_url,
        'repostFromUserId', source_user.id,
        'repostFromUserName', source_user.name,
        'repostFromUserUsername', source_user.username,
        'repostFromUserAvatarUrl', source_user.avatar_url
      )
      ELSE NULL
    END AS data
    FROM message_shares ms
    LEFT JOIN posts p ON p.id = ms.post_id
    LEFT JOIN users post_author ON post_author.id = p.user_id
    LEFT JOIN stories s ON s.id = ms.story_id
    LEFT JOIN users story_author ON story_author.id = s.user_id
    LEFT JOIN stories source_story ON source_story.id = s.repost_from_story_id
    LEFT JOIN users source_user ON source_user.id = source_story.user_id
    WHERE ms.message_id = m.id
    LIMIT 1
  ) shared_content ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'id', rm.id,
      'body', CASE WHEN rm.is_deleted THEN '' ELSE rm.body END,
      'senderId', rm.sender_id,
      'senderName', reply_sender.name,
      'isDeleted', rm.is_deleted,
      'attachmentLabel',
        CASE
          WHEN rm.is_deleted THEN 'Message unsent'
          ELSE COALESCE(
            ${shareLabelSql('reply_share.share_type')},
            ${attachmentLabelSql(
              'reply_attachment_counts.count',
              'reply_first_attachment.file_type',
              'rm.media_type',
              'rm.media_url',
            )}
          )
        END
    ) AS data
    FROM messages rm
    INNER JOIN users reply_sender ON reply_sender.id = rm.sender_id
    LEFT JOIN message_shares reply_share ON reply_share.message_id = rm.id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INT AS count
      FROM message_attachments reply_attachment
      WHERE reply_attachment.message_id = rm.id
    ) reply_attachment_counts ON true
    LEFT JOIN LATERAL (
      SELECT reply_attachment.file_type
      FROM message_attachments reply_attachment
      WHERE reply_attachment.message_id = rm.id
      ORDER BY reply_attachment.created_at ASC
      LIMIT 1
    ) reply_first_attachment ON true
    WHERE rm.id = m.reply_to_message_id
  ) reply_message ON true
`

async function userInChat(executor, chatId, userId) {
  const membership = await executor.query(`SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2`, [chatId, userId])
  return membership.rowCount > 0
}

async function fetchMessageById(executor, messageId, viewerId) {
  const result = await executor.query(`${MESSAGE_SELECT_SQL} WHERE m.id = $1`, [messageId, viewerId])
  return result.rows[0] || null
}

async function emitChatEvent(req, chatId, eventName, payload) {
  const io = req.app.get('io')
  if (!io) return

  const members = await pool.query('SELECT user_id FROM chat_members WHERE chat_id = $1', [chatId])
  io.to(`chat:${chatId}`).emit(eventName, payload)
  for (const member of members.rows) {
    io.to(`user:${member.user_id}`).emit(eventName, payload)
  }
}

async function validateSharedReference(client, sharedType, sharedItemId) {
  if (!sharedType && !sharedItemId) return null
  if (!sharedType || !sharedItemId) return { error: 'shared_content_invalid' }

  if (sharedType === 'post') {
    const result = await client.query(`SELECT id FROM posts WHERE id = $1 AND post_kind = 'post'`, [sharedItemId])
    if (result.rowCount === 0) return { error: 'shared_post_not_found' }
    return { shareType: 'post', postId: sharedItemId, storyId: null }
  }

  if (sharedType === 'reel') {
    const result = await client.query(`SELECT id FROM posts WHERE id = $1 AND post_kind = 'reel'`, [sharedItemId])
    if (result.rowCount === 0) return { error: 'shared_reel_not_found' }
    return { shareType: 'reel', postId: sharedItemId, storyId: null }
  }

  if (sharedType === 'story') {
    const result = await client.query(`SELECT id FROM stories WHERE id = $1 AND expires_at > NOW()`, [sharedItemId])
    if (result.rowCount === 0) return { error: 'shared_story_not_found' }
    return { shareType: 'story', postId: null, storyId: sharedItemId }
  }

  return { error: 'shared_content_invalid' }
}

async function listChats(req, res) {
  const result = await pool.query(
    `SELECT
      c.id,
      c.is_group AS "isGroup",
      COALESCE(c.title, other_user.name, other_user.username, other_user.email, 'Chat') AS title,
      other_user.username AS "username",
      other_user.email AS "email",
      other_user.avatar_url AS "avatarUrl",
      last_message.body AS "lastMessage",
      last_message.created_at AS "lastMessageAt"
    FROM chats c
    INNER JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $1
    LEFT JOIN LATERAL (
      SELECT
        ${messagePreviewSql(
          'm.body',
          'attachment_counts.count',
          'first_attachment.file_type',
          'm.media_type',
          'm.media_url',
          'm.is_deleted',
          'message_share.share_type',
        )} AS body,
        m.created_at
      FROM messages m
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS count
        FROM message_attachments a
        WHERE a.message_id = m.id
      ) attachment_counts ON true
      LEFT JOIN LATERAL (
        SELECT a.file_type
        FROM message_attachments a
        WHERE a.message_id = m.id
        ORDER BY a.created_at ASC
        LIMIT 1
      ) first_attachment ON true
      LEFT JOIN message_shares message_share ON message_share.message_id = m.id
      WHERE m.chat_id = c.id
      ORDER BY m.created_at DESC
      LIMIT 1
    ) last_message ON true
    LEFT JOIN LATERAL (
      SELECT u.name, u.username, u.email, u.avatar_url
      FROM chat_members cm
      INNER JOIN users u ON u.id = cm.user_id
      WHERE cm.chat_id = c.id AND cm.user_id <> $1
      LIMIT 1
    ) other_user ON true
    ORDER BY COALESCE(last_message.created_at, c.created_at) DESC`,
    [req.user.id],
  )
  return res.json(result.rows)
}

async function searchUsers(req, res) {
  const queryText = String(req.query.q || '').trim()
  if (queryText.length < 2) return res.json([])

  const like = `%${queryText.toLowerCase()}%`
  const result = await pool.query(
    `SELECT
      id,
      name,
      username,
      email,
      avatar_url AS "avatarUrl"
    FROM users
    WHERE
      id <> $1
      AND (
        LOWER(username) LIKE $2
        OR LOWER(email) LIKE $2
        OR LOWER(name) LIKE $2
      )
    ORDER BY
      CASE
        WHEN LOWER(username) = LOWER($3) THEN 0
        WHEN LOWER(email) = LOWER($3) THEN 1
        ELSE 2
      END,
      created_at DESC
    LIMIT 20`,
    [req.user.id, like, queryText.toLowerCase()],
  )

  return res.json(result.rows)
}

async function createDirectChat(req, res) {
  const { recipientEmail, recipientId } = req.body || {}
  if (!recipientEmail && !recipientId) {
    return res.status(400).json({ error: 'recipient_required' })
  }

  let userResult
  if (recipientId) {
    userResult = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [recipientId])
  } else {
    const search = String(recipientEmail).toLowerCase().trim()
    userResult = await pool.query(
      `SELECT id, email, name
       FROM users
       WHERE LOWER(email) = $1 OR LOWER(username) = $1`,
      [search],
    )
  }

  if (userResult.rowCount === 0) return res.status(404).json({ error: 'recipient_not_found' })

  const recipient = userResult.rows[0]
  if (recipient.id === req.user.id) return res.status(400).json({ error: 'cannot_chat_with_self' })

  const existing = await pool.query(
    `SELECT c.id
     FROM chats c
     INNER JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $1
     INNER JOIN chat_members recipient ON recipient.chat_id = c.id AND recipient.user_id = $2
     WHERE c.is_group = false
     LIMIT 1`,
    [req.user.id, recipient.id],
  )

  if (existing.rowCount > 0) {
    return res.json({ chatId: existing.rows[0].id, created: false })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const chatId = randomUUID()
    await client.query(
      `INSERT INTO chats (id, is_group, created_by, title)
       VALUES ($1, false, $2, null)`,
      [chatId, req.user.id],
    )
    await client.query(
      `INSERT INTO chat_members (chat_id, user_id)
       VALUES ($1, $2), ($1, $3)`,
      [chatId, req.user.id, recipient.id],
    )
    await client.query('COMMIT')
    return res.status(201).json({ chatId, created: true })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function listMessages(req, res) {
  const { chatId } = req.params
  if (!(await userInChat(pool, chatId, req.user.id))) {
    return res.status(403).json({ error: 'forbidden_chat' })
  }

  const result = await pool.query(`${MESSAGE_SELECT_SQL} WHERE m.chat_id = $1 ORDER BY m.created_at ASC`, [
    chatId,
    req.user.id,
  ])

  return res.json(result.rows)
}

async function sendMessage(req, res) {
  const { chatId } = req.params
  const textBody = (req.body?.body || '').trim()
  const replyToMessageId = String(req.body?.replyToMessageId || '').trim() || null
  const sharedType = String(req.body?.sharedType || '').trim().toLowerCase() || null
  const sharedItemId = String(req.body?.sharedItemId || '').trim() || null
  const files = Array.isArray(req.files) ? req.files : []

  if (!(await userInChat(pool, chatId, req.user.id))) {
    return res.status(403).json({ error: 'forbidden_chat' })
  }

  if (!textBody && files.length === 0 && !sharedType && !sharedItemId) {
    return res.status(400).json({ error: 'message_body_or_media_required' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (replyToMessageId) {
      const replyTarget = await client.query(`SELECT id FROM messages WHERE id = $1 AND chat_id = $2`, [
        replyToMessageId,
        chatId,
      ])
      if (replyTarget.rowCount === 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'reply_message_invalid' })
      }
    }

    const sharedReference = await validateSharedReference(client, sharedType, sharedItemId)
    if (sharedReference?.error) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: sharedReference.error })
    }

    const messageId = randomUUID()
    await client.query(
      `INSERT INTO messages (id, chat_id, sender_id, body, media_url, media_type, reply_to_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        messageId,
        chatId,
        req.user.id,
        textBody,
        files[0] ? `/uploads/${files[0].filename}` : null,
        files[0] ? mapAttachmentType(files[0].mimetype, files[0].originalname || files[0].filename) : null,
        replyToMessageId,
      ],
    )

    for (const file of files) {
      await client.query(
        `INSERT INTO message_attachments (id, message_id, file_url, file_type, file_name, file_size)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          messageId,
          `/uploads/${file.filename}`,
          mapAttachmentType(file.mimetype, file.originalname || file.filename),
          file.originalname || file.filename,
          file.size || 0,
        ],
      )
    }

    if (sharedReference) {
      await client.query(
        `INSERT INTO message_shares (id, message_id, share_type, post_id, story_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          messageId,
          sharedReference.shareType,
          sharedReference.postId,
          sharedReference.storyId,
        ],
      )

      if (sharedReference.postId) {
        await client.query(
          `INSERT INTO post_shares (id, post_id, user_id)
           VALUES ($1, $2, $3)`,
          [randomUUID(), sharedReference.postId, req.user.id],
        )
      }
    }

    const payload = await fetchMessageById(client, messageId, req.user.id)
    await client.query('COMMIT')

    try {
      await emitChatEvent(req, chatId, 'chat:message', { chatId, message: payload })
    } catch (emitError) {
      // eslint-disable-next-line no-console
      console.error('chat_emit_failed', emitError)
    }

    return res.status(201).json(payload)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function toggleReaction(req, res) {
  const { chatId, messageId } = req.params
  const emoji = String(req.body?.emoji || '').trim()

  if (!emoji || emoji.length > 16) {
    return res.status(400).json({ error: 'emoji_required' })
  }

  if (!(await userInChat(pool, chatId, req.user.id))) {
    return res.status(403).json({ error: 'forbidden_chat' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const messageResult = await client.query(
      `SELECT id, is_deleted AS "isDeleted"
       FROM messages
       WHERE id = $1 AND chat_id = $2`,
      [messageId, chatId],
    )

    if (messageResult.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'message_not_found' })
    }

    if (messageResult.rows[0].isDeleted) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'message_deleted' })
    }

    const existingReaction = await client.query(
      `SELECT emoji FROM message_reactions WHERE message_id = $1 AND user_id = $2`,
      [messageId, req.user.id],
    )

    if (existingReaction.rowCount > 0 && existingReaction.rows[0].emoji === emoji) {
      await client.query(
        `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2`,
        [messageId, req.user.id],
      )
    } else if (existingReaction.rowCount > 0) {
      await client.query(
        `UPDATE message_reactions
         SET emoji = $3, created_at = NOW()
         WHERE message_id = $1 AND user_id = $2`,
        [messageId, req.user.id, emoji],
      )
    } else {
      await client.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji)
         VALUES ($1, $2, $3)`,
        [messageId, req.user.id, emoji],
      )
    }

    const payload = await fetchMessageById(client, messageId, req.user.id)
    await client.query('COMMIT')

    try {
      await emitChatEvent(req, chatId, 'chat:message_updated', { chatId, message: payload })
    } catch (emitError) {
      // eslint-disable-next-line no-console
      console.error('chat_emit_failed', emitError)
    }

    return res.json(payload)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function deleteMessage(req, res) {
  const { chatId, messageId } = req.params

  if (!(await userInChat(pool, chatId, req.user.id))) {
    return res.status(403).json({ error: 'forbidden_chat' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const messageResult = await client.query(
      `SELECT id, sender_id AS "senderId", is_deleted AS "isDeleted"
       FROM messages
       WHERE id = $1 AND chat_id = $2`,
      [messageId, chatId],
    )

    if (messageResult.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'message_not_found' })
    }

    const message = messageResult.rows[0]
    if (message.senderId !== req.user.id) {
      await client.query('ROLLBACK')
      return res.status(403).json({ error: 'message_delete_forbidden' })
    }

    if (message.isDeleted) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'message_already_deleted' })
    }

    await client.query(`DELETE FROM message_attachments WHERE message_id = $1`, [messageId])
    await client.query(`DELETE FROM message_reactions WHERE message_id = $1`, [messageId])
    await client.query(`DELETE FROM message_shares WHERE message_id = $1`, [messageId])
    await client.query(
      `UPDATE messages
       SET
         body = '',
         media_url = NULL,
         media_type = NULL,
         is_deleted = true,
         deleted_at = NOW(),
         deleted_by_user_id = $2
       WHERE id = $1`,
      [messageId, req.user.id],
    )

    const payload = await fetchMessageById(client, messageId, req.user.id)
    await client.query('COMMIT')

    try {
      await emitChatEvent(req, chatId, 'chat:message_updated', { chatId, message: payload })
    } catch (emitError) {
      // eslint-disable-next-line no-console
      console.error('chat_emit_failed', emitError)
    }

    return res.json(payload)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = {
  listChats,
  searchUsers,
  createDirectChat,
  listMessages,
  sendMessage,
  toggleReaction,
  deleteMessage,
}
