
-- 创建文章详情表
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT DEFAULT '',
  source TEXT DEFAULT '',
  author TEXT DEFAULT '',
  published_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  digest_id INTEGER REFERENCES digests(id) ON DELETE CASCADE,
  metadata TEXT DEFAULT '{}',
  word_count INTEGER DEFAULT 0,
  language TEXT DEFAULT 'en'
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE INDEX IF NOT EXISTS idx_articles_digest_id ON articles(digest_id);
CREATE INDEX IF NOT EXISTS idx_articles_fetched_at ON articles(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
