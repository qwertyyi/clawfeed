CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tweet_id TEXT NOT NULL,
  tweet_url TEXT,
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  local_path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  size INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_tweet_id
ON media(tweet_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_url
ON media(url);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_unique
ON media(tweet_id, url);