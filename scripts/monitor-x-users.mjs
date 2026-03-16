import { getDb } from '../src/db.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ProxyAgent, setGlobalDispatcher } from "undici";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');


const proxy =
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  "http://127.0.0.1:7897";

console.log("Using proxy:", proxy);

setGlobalDispatcher(new ProxyAgent(proxy));


// 媒体目录
const MEDIA_DIR = join(ROOT, "media");
const IMG_DIR = join(MEDIA_DIR, "images");
const VIDEO_DIR = join(MEDIA_DIR, "videos");

[MEDIA_DIR, IMG_DIR, VIDEO_DIR].forEach(d => {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
});

// 加载环境变量
const envPath = join(ROOT, '.env');
const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
}

const TOKEN = env.TWITTER_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;

const USERS = {
  "Elon Musk": "44196397",
  "Donald Trump": "25073877"
};

const db = getDb(join(ROOT, "data", "digest.db"));

// 确保 tweets 表存在
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

// 为现有表添加新字段（如果不存在）
try {
  db.exec(`ALTER TABLE tweets ADD COLUMN public_metrics TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE tweets ADD COLUMN entities TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE tweets ADD COLUMN geo TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE tweets ADD COLUMN lang TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE tweets ADD COLUMN possibly_sensitive INTEGER DEFAULT 0`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE tweets ADD COLUMN reply_settings TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE tweets ADD COLUMN source TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE tweets ADD COLUMN conversation_id TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE tweets ADD COLUMN in_reply_to_user_id TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE tweets ADD COLUMN referenced_tweet_id TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE tweets ADD COLUMN author_info TEXT`);
} catch (e) {}

// 获取推文 + 媒体
async function fetchTweets(userId) {

  const url =
    `https://api.twitter.com/2/users/${userId}/tweets` +
    `?max_results=5` +
    `&tweet.fields=created_at,attachments,text,public_metrics,entities,geo,lang,possibly_sensitive,referenced_tweets,reply_settings,source,withheld,conversation_id,in_reply_to_user_id` +
    `&expansions=attachments.media_keys,referenced_tweets.id,author_id,in_reply_to_user_id` +
    `&media.fields=url,preview_image_url,type,media_key,width,height,duration_ms,variants,alt_text` +
    `&user.fields=name,username,verified,profile_image_url,public_metrics`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });

  const json = await res.json();

  // 构建引用推文的映射
  const referencedTweets = {};
  if (json.includes?.tweets) {
    json.includes.tweets.forEach(tweet => {
      referencedTweets[tweet.id] = tweet;
    });
  }

  // 构建用户信息的映射
  const users = {};
  if (json.includes?.users) {
    json.includes.users.forEach(user => {
      users[user.id] = user;
    });
  }

  return {
    tweets: (json.data || []).map(tweet => ({
      ...tweet,
      referenced_tweet: tweet.referenced_tweets?.[0]?.id ? referencedTweets[tweet.referenced_tweets[0].id] : null,
      author: users[tweet.author_id] || null
    })),
    media: json.includes?.media || [],
    users: users
  };
}

// 下载文件
async function downloadFile(url, path) {

  try {

    if (existsSync(path)) return;

    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());

    writeFileSync(path, buffer);

    console.log("Downloaded:", path);

  } catch (err) {
    console.error("Download failed:", url);
  }

}

// 保存推文
function saveTweet(user, tweet) {
  // 先检查推文是否已存在
  const exists = db.prepare("SELECT id FROM tweets WHERE id=?").get(tweet.id);

  if (!exists) {
    // 保存主推文
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO tweets 
      (id, user, text, created_at, public_metrics, entities, geo, lang, 
       possibly_sensitive, reply_settings, source, conversation_id, 
       in_reply_to_user_id, referenced_tweet_id, author_info)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    stmt.run(
      tweet.id,
      user,
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
      tweet.referenced_tweet?.id || '',
      JSON.stringify(tweet.author || {})
    );

    // 如果有引用推文，也保存它
    if (tweet.referenced_tweet) {
      saveTweet(user, tweet.referenced_tweet);
    }
  }
}

// 保存媒体
function saveMedia(tweetId, type, url, path) {

  const stmt = db.prepare(`
    INSERT INTO media (tweet_id, type, url, local_path)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(tweetId, type, url, path);

}

// 处理媒体
async function handleMedia(tweet, mediaList) {

  if (!tweet.attachments?.media_keys) return;

  for (const key of tweet.attachments.media_keys) {

    const media = mediaList.find(m => m.media_key === key);
    if (!media) continue;

    if (media.type === "photo") {

      const filename = join(IMG_DIR, `${key}.jpg`);

      await downloadFile(media.url, filename);

      saveMedia(tweet.id, "photo", media.url, filename);

    }

    if (media.type === "video" || media.type === "animated_gif") {

      const preview = media.preview_image_url;

      const filename = join(VIDEO_DIR, `${key}.jpg`);

      await downloadFile(preview, filename);

      saveMedia(tweet.id, "video", preview, filename);

    }

  }

}

// 处理推文文本中的图片链接
async function handleTextImages(tweetId, text) {
  // 匹配 http/https 开头的 URL
  const urlRegex = /(https?:\/\/[^\s<>"{}|\^`\[\]]+)/g;
  const urls = text.match(urlRegex);

  if (!urls) return;

  for (const url of urls) {
    try {
      console.log("Checking URL:", url);

      // 跟踪所有重定向以获取最终 URL 和 Content-Type
      let finalUrl = url;
      let contentType = null;
      let currentUrl = url;
      let redirectCount = 0;
      const maxRedirects = 10;

      while (redirectCount < maxRedirects) {
        const res = await fetch(currentUrl, { 
          method: 'HEAD',
          redirect: 'manual'
        });

        // 检查 Content-Type
        const resContentType = res.headers.get('content-type');
        if (resContentType) {
          contentType = resContentType.split(';')[0].trim();
        }

        // 处理重定向
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (location) {
            currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
            finalUrl = currentUrl;
            redirectCount++;
            continue;
          }
        }

        // 没有重定向或出错，退出循环
        break;
      }

      console.log("Final URL:", finalUrl);
      console.log("Content-Type:", contentType);

      // 检查是否是图片（通过 Content-Type）
      const imageContentTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'];
      const isImage = contentType && imageContentTypes.includes(contentType.toLowerCase());

      if (isImage) {
        // 根据 Content-Type 确定文件扩展名
        const extMap = {
          'image/jpeg': '.jpg',
          'image/png': '.png',
          'image/gif': '.gif',
          'image/webp': '.webp',
          'image/bmp': '.bmp',
          'image/svg+xml': '.svg'
        };
        const ext = extMap[contentType.toLowerCase()] || '.jpg';

        // 生成文件名
        const urlHash = Buffer.from(finalUrl).toString('base64').slice(0, 16);
        const filename = join(IMG_DIR, `text_${tweetId}_${urlHash}${ext}`);

        await downloadFile(finalUrl, filename);
        saveMedia(tweetId, "text_image", finalUrl, filename);
        console.log("✓ Saved text image:", finalUrl);
      } else {
        console.log("✗ Not an image:", finalUrl);
      }
    } catch (err) {
      console.error("✗ Failed to process text image:", url, err.message);
    }
  }
}

// 主监控函数
async function monitor() {

  for (const [name, id] of Object.entries(USERS)) {

    console.log(`\nChecking ${name}...`);

    const { tweets, media } = await fetchTweets(id);

    for (const t of tweets.reverse()) {

      const exists = db.prepare(
        "SELECT id FROM tweets WHERE id=?"
      ).get(t.id);

      if (!exists) {

        saveTweet(name, t);

        await handleMedia(t, media);

        // 处理推文文本中的图片链接
        await handleTextImages(t.id, t.text);

        console.log("\nNEW TWEET");
        console.log(name);
        console.log(t.created_at);
        console.log(t.text);
        console.log("----");

      }

    }

  }

}

monitor();