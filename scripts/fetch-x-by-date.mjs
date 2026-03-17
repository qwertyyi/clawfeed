import { getDb } from '../src/db.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ProxyAgent } from "undici";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ======================== 1. 加载 .env 配置 ========================
const envPath = join(ROOT, '.env');
const env = {};

if (existsSync(envPath)) {
  try {
    const envContent = readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        env[key] = value;
        process.env[key] = value;
      }
    }
    console.log(`✅ Loaded .env file from: ${envPath}`);
  } catch (err) {
    console.error(`⚠️ Failed to read .env file: ${err.message}`);
  }
}

// ======================== 2. 核心配置 ========================
// Twitter Bearer Token 校验
const TOKEN = env.TWITTER_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
if (!TOKEN) {
  console.error('❌ Error: TWITTER_BEARER_TOKEN is not set in .env file!');
  process.exit(1);
}

// 代理配置
const proxyUrl = env.HTTPS_PROXY || env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const agent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
if (proxyUrl) console.log(`✅ Using proxy: ${proxyUrl}`);

// 重试/延迟配置
const MAX_RETRIES = parseInt(env.MAX_RETRIES || '3', 10);
const RETRY_DELAY = parseInt(env.RETRY_DELAY || '5000', 10);
const REQUEST_DELAY = parseInt(env.REQUEST_DELAY || '3000', 10);

// ======================== 3. 目录初始化 ========================
const MEDIA_DIR = join(ROOT, "media");
const IMG_DIR = join(MEDIA_DIR, "images");
const VIDEO_DIR = join(MEDIA_DIR, "videos");

[MEDIA_DIR, IMG_DIR, VIDEO_DIR].forEach(d => {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
});

// ======================== 4. 数据库初始化 ========================
const db = getDb(join(ROOT, "data", "digest.db"));

// 创建 tweets 表
db.exec(`
  CREATE TABLE IF NOT EXISTS tweets (
    id TEXT PRIMARY KEY,
    user TEXT,
    text TEXT,
    created_at TEXT,
    public_metrics TEXT,
    entities TEXT,
    geo TEXT,
    lang TEXT,
    possibly_sensitive INTEGER DEFAULT 0,
    reply_settings TEXT,
    source TEXT,
    conversation_id TEXT,
    in_reply_to_user_id TEXT,
    referenced_tweet_id TEXT,
    author_info TEXT
  )
`);

// 兼容旧表字段
const addColumnIfNotExists = (table, column, type) => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.warn(`⚠️ Failed to add column ${column}: ${e.message}`);
    }
  }
};

addColumnIfNotExists('tweets', 'public_metrics', 'TEXT');
addColumnIfNotExists('tweets', 'entities', 'TEXT');
addColumnIfNotExists('tweets', 'geo', 'TEXT');
addColumnIfNotExists('tweets', 'lang', 'TEXT');
addColumnIfNotExists('tweets', 'possibly_sensitive', 'INTEGER DEFAULT 0');
addColumnIfNotExists('tweets', 'reply_settings', 'TEXT');
addColumnIfNotExists('tweets', 'source', 'TEXT');
addColumnIfNotExists('tweets', 'conversation_id', 'TEXT');
addColumnIfNotExists('tweets', 'in_reply_to_user_id', 'TEXT');
addColumnIfNotExists('tweets', 'referenced_tweet_id', 'TEXT');
addColumnIfNotExists('tweets', 'author_info', 'TEXT');

// ======================== 5. 带重试的 Fetch ========================
async function fetchWithRetry(url, options) {
  let lastError;
  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    try {
      const res = await fetch(url, { ...options, dispatcher: agent });
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || `${RETRY_DELAY / 1000}`, 10);
        console.log(`⚠️ Rate limited! Retry after ${retryAfter}s (${retry + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      if (retry < MAX_RETRIES - 1) {
        console.log(`⚠️ Fetch failed (${retry + 1}/${MAX_RETRIES}): ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }
  throw new Error(`❌ All retries failed: ${lastError.message}`);
}

// ======================== 6. 获取推文 ========================
async function fetchTweets(userId, startDate, endDate) {
  const startTime = new Date(startDate).getTime();
  const endTime = new Date(endDate).getTime();

  console.log(`  📅 Date range: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);

  const allTweets = [];
  let nextToken = null;
  let pageCount = 0;
  const maxPages = 100;

  while (pageCount < maxPages) {
    pageCount++;
    console.log(`  📄 Fetching page ${pageCount}...`);

    const urlParams = new URLSearchParams({
      max_results: '100',
      'tweet.fields': 'created_at,attachments,text,public_metrics,entities,geo,lang,possibly_sensitive,referenced_tweets,reply_settings,source,withheld,conversation_id,in_reply_to_user_id',
      expansions: 'attachments.media_keys,referenced_tweets.id,author_id,in_reply_to_user_id',
      'media.fields': 'url,preview_image_url,type,media_key,width,height,duration_ms,variants,alt_text',
      'user.fields': 'name,username,verified,profile_image_url,public_metrics'
    });
    if (nextToken) urlParams.append('pagination_token', encodeURIComponent(nextToken));

    const url = `https://api.twitter.com/2/users/${userId}/tweets?${urlParams.toString()}`;
    const data = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });

    const tweets = data.data || [];
    const filteredTweets = tweets.filter(tweet => {
      const tweetTime = new Date(tweet.created_at).getTime();
      return tweetTime >= startTime && tweetTime <= endTime;
    });

    allTweets.push(...filteredTweets);
    nextToken = data.meta?.next_token;

    if (!nextToken) {
      console.log(`  ✨ No more pages (page ${pageCount})`);
      break;
    }

    const oldestTweet = tweets[tweets.length - 1];
    if (oldestTweet && new Date(oldestTweet.created_at).getTime() < startTime) {
      console.log(`  🛑 Stopped at page ${pageCount} (reached tweets before start date)`);
      break;
    }

    await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
  }

  console.log(`  📊 Found ${allTweets.length} tweets in date range`);
  return allTweets;
}

// ======================== 7. 保存推文 ========================
function saveTweets(tweets, userName) {
  let savedCount = 0;

  db.transaction(() => {
    for (const tweet of tweets) {
      const exists = db.prepare("SELECT id FROM tweets WHERE id=?").get(tweet.id);
      if (!exists) {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO tweets
          (id, user, text, created_at, public_metrics, entities, geo, lang,
           possibly_sensitive, reply_settings, source, conversation_id,
           in_reply_to_user_id, referenced_tweet_id, author_info)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `);

        stmt.run(
          tweet.id,
          userName,
          tweet.text,
          tweet.created_at,
          JSON.stringify(tweet.public_metrics || {}),
          JSON.stringify(tweet.entities || {}),
          JSON.stringify(tweet.geo || {}),
          tweet.lang || '',
          tweet.possibly_sensitive ? 1 : 0,
          tweet.reply_settings || '',
          tweet.source || '',
          tweet.conversation_id || '',
          tweet.in_reply_to_user_id || '',
          tweet.referenced_tweets?.[0]?.id || '',
          JSON.stringify(tweet.author || {})
        );

        savedCount++;
      }
    }
  })();

  return savedCount;
}

// ======================== 8. 主函数 ========================
async function main() {
  // 修复：字符串换行用 \n 或反引号，避免语法错误
  const args = process.argv.slice(2);
  const dateStr = args[0];

  let targetDate = null;
  if (dateStr) {
    targetDate = {
      start: `${dateStr}T00:00:00Z`,
      end: `${dateStr}T23:59:59Z`
    };
    // 正确写法1：用 \n 表示换行
    console.log(`Fetching tweets for ${dateStr}...\n`);
  } else {
    // 正确写法2：用反引号包裹多行字符串
    console.log(`Fetching latest tweets...
`);
  }

  const USERS = {
    "Elon Musk": "44196397",
    "Donald Trump": "25073877"
  };

  for (const [name, id] of Object.entries(USERS)) {
    console.log(`🔍 Processing ${name} (ID: ${id})...`);
    try {
      const tweets = await fetchTweets(id, targetDate.start, targetDate.end);
      const savedCount = saveTweets(tweets, name);
      console.log(`  ✨ Found ${tweets.length} tweets`);
      console.log(`  💾 Saved ${savedCount} new tweets\n`);
    } catch (err) {
      console.error(`❌ Error processing ${name}: ${err.message}\n`);
    }
  }

  console.log("✅ Done!");
}

main().catch(err => {
  console.error('💥 Fatal error:', err.message);
  process.exit(1);
});