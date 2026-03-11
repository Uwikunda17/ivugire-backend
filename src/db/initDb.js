const { pool } = require('./pool')

async function initDb() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        username TEXT UNIQUE,
        bio TEXT,
        location TEXT,
        website TEXT,
        avatar_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_kind TEXT NOT NULL DEFAULT 'post' CHECK (post_kind IN ('post', 'reel')),
        caption TEXT NOT NULL DEFAULT '',
        media_url TEXT NOT NULL,
        media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio')),
        media_duration_seconds INTEGER,
        trim_end_seconds INTEGER,
        is_trimmed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS post_likes (
        post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (post_id, user_id)
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS post_comments (
        id UUID PRIMARY KEY,
        post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS post_shares (
        id UUID PRIMARY KEY,
        post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS post_views (
        post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (post_id, user_id)
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id UUID PRIMARY KEY,
        title TEXT,
        is_group BOOLEAN NOT NULL DEFAULT FALSE,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_members (
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chat_id, user_id)
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY,
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL DEFAULT '',
        media_url TEXT,
        media_type TEXT,
        reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_at TIMESTAMPTZ,
        deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS message_attachments (
        id UUID PRIMARY KEY,
        message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        file_url TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_id, user_id)
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS stories (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        caption TEXT NOT NULL DEFAULT '',
        media_url TEXT NOT NULL,
        media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio')),
        media_duration_seconds INTEGER,
        trim_end_seconds INTEGER,
        is_trimmed BOOLEAN NOT NULL DEFAULT FALSE,
        sticker_text TEXT,
        animation_preset TEXT,
        media_filter TEXT,
        word_filter_level TEXT,
        repost_from_story_id UUID REFERENCES stories(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS story_views (
        story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (story_id, user_id)
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS story_tags (
        story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (story_id, user_id)
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS message_shares (
        id UUID PRIMARY KEY,
        message_id UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
        share_type TEXT NOT NULL CHECK (share_type IN ('post', 'reel', 'story')),
        post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
        story_id UUID REFERENCES stories(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL
    `)
    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE
    `)
    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
    `)
    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
    `)
    await client.query(`
      ALTER TABLE stories ADD COLUMN IF NOT EXISTS media_duration_seconds INTEGER
    `)
    await client.query(`
      ALTER TABLE stories ADD COLUMN IF NOT EXISTS trim_end_seconds INTEGER
    `)
    await client.query(`
      ALTER TABLE stories ADD COLUMN IF NOT EXISTS is_trimmed BOOLEAN NOT NULL DEFAULT FALSE
    `)
    await client.query(`
      ALTER TABLE stories ADD COLUMN IF NOT EXISTS sticker_text TEXT
    `)
    await client.query(`
      ALTER TABLE stories ADD COLUMN IF NOT EXISTS animation_preset TEXT
    `)
    await client.query(`
      ALTER TABLE stories ADD COLUMN IF NOT EXISTS media_filter TEXT
    `)
    await client.query(`
      ALTER TABLE stories ADD COLUMN IF NOT EXISTS word_filter_level TEXT
    `)
    await client.query(`
      ALTER TABLE stories ADD COLUMN IF NOT EXISTS repost_from_story_id UUID REFERENCES stories(id) ON DELETE SET NULL
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_post_comments_post_id_created_at ON post_comments(post_id, created_at DESC)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_post_views_post_id_viewed_at ON post_views(post_id, viewed_at DESC)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created_at ON messages(chat_id, created_at DESC)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_reply_to_message_id ON messages(reply_to_message_id)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions(message_id)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_message_shares_message_id ON message_shares(message_id)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stories_user_id_created_at ON stories(user_id, created_at DESC)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stories_expires_at ON stories(expires_at)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stories_repost_from_story_id ON stories(repost_from_story_id)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_story_tags_story_id ON story_tags(story_id)
    `)

    // Follow system
    await client.query(`
      CREATE TABLE IF NOT EXISTS follows (
        follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (follower_id, following_id),
        CHECK (follower_id <> following_id)
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows(following_id)
    `)

    // Message requests
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_requests (
        id UUID PRIMARY KEY,
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (chat_id)
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_message_requests_recipient_id_status ON message_requests(recipient_id, status)
    `)

    // Voice and video calls
    await client.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id UUID PRIMARY KEY,
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        initiator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
        call_type TEXT NOT NULL CHECK (call_type IN ('audio', 'video')),
        status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'accepted', 'declined', 'ended', 'missed')),
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        duration_seconds INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_calls_chat_id_created_at ON calls(chat_id, created_at DESC)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_calls_recipient_id_status ON calls(recipient_id, status)
    `)

    // Notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notification_type TEXT NOT NULL CHECK (notification_type IN ('follow', 'like', 'comment', 'share', 'message', 'mention')),
        related_post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
        related_story_id UUID REFERENCES stories(id) ON DELETE CASCADE,
        related_chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
        text TEXT,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at ON notifications(user_id, created_at DESC)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id_is_read ON notifications(user_id, is_read)
    `)

    // Multi-media support for posts
    await client.query(`
      CREATE TABLE IF NOT EXISTS post_media_items (
        id UUID PRIMARY KEY,
        post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        media_url TEXT NOT NULL,
        media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio')),
        media_duration_seconds INTEGER,
        trim_end_seconds INTEGER,
        is_trimmed BOOLEAN NOT NULL DEFAULT FALSE,
        sequence_order INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_post_media_items_post_id ON post_media_items(post_id, sequence_order)
    `)

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = { initDb }
