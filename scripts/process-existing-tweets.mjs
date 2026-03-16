import { getDb } from "../src/db.mjs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ProxyAgent } from "undici";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// 代理
const proxy = process.env.HTTP_PROXY;
const agent = proxy ? new ProxyAgent(proxy) : undefined;

// 媒体目录
const MEDIA_DIR = join(ROOT, "media");
const IMG_DIR = join(MEDIA_DIR, "images");

const db = getDb(join(ROOT, "data", "digest.db"));

// 确保 media 表存在
db.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id TEXT,
    type TEXT,
    url TEXT,
    filename TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// 下载文件
async function downloadFile(url, filepath) {
  const response = await fetch(url, { dispatcher: agent });
  const buffer = await response.arrayBuffer();
  const fs = await import('fs');
  fs.writeFileSync(filepath, Buffer.from(buffer));
}

// 保存媒体记录
function saveMedia(tweetId, type, url, filename) {
  const stmt = db.prepare(`
    INSERT INTO media (tweet_id, type, url, filename)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(tweetId, type, url, filename);
}

// 处理推文文本中的图片链接
async function handleTextImages(tweetId, text) {
  // 匹配 http/https 开头的 URL
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^\`\[\]]+)/g;
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
          dispatcher: agent,
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
        // 如果是 Twitter 图片链接（/photo/1），尝试从 HTML 中提取图片 URL
        if (finalUrl.includes('twitter.com') && finalUrl.includes('/photo/')) {
          console.log("Twitter photo link detected, trying to extract image URL...");

          try {
            // 使用 GET 请求获取页面内容
            const res = await fetch(finalUrl, { 
              method: 'GET',
              dispatcher: agent,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              }
            });

            const html = await res.text();

            // 从 HTML 中提取图片 URL
            // Twitter 的图片通常在 meta 标签中，格式如：og:image 或 twitter:image
            const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"[^>]*>/i);
            const twitterImageMatch = html.match(/<meta[^>]*name="twitter:image"[^>]*content="([^"]*)"[^>]*>/i);

            const imageUrl = ogImageMatch?.[1] || twitterImageMatch?.[1];

            if (imageUrl) {
              console.log("Found image URL in HTML:", imageUrl);

              // 下载图片
              const extMap = {
                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/gif': '.gif',
                'image/webp': '.webp',
                'image/bmp': '.bmp',
                'image/svg+xml': '.svg'
              };

              // 获取图片的 Content-Type
              const imgRes = await fetch(imageUrl, { method: 'HEAD', dispatcher: agent });
              const imgContentType = imgRes.headers.get('content-type')?.split(';')[0].trim() || 'image/jpeg';
              const ext = extMap[imgContentType.toLowerCase()] || '.jpg';

              const urlHash = Buffer.from(imageUrl).toString('base64').slice(0, 16);
              const filename = join(IMG_DIR, `text_${tweetId}_${urlHash}${ext}`);

              await downloadFile(imageUrl, filename);
              saveMedia(tweetId, "text_image", imageUrl, filename);
              console.log("✓ Saved Twitter image:", imageUrl);
            } else {
              console.log("✗ Could not find image URL in HTML");
            }
          } catch (err) {
            console.error("✗ Failed to extract Twitter image:", err.message);
          }
        } else {
          console.log("✗ Not an image:", finalUrl);
        }
      }
    } catch (err) {
      console.error("✗ Failed to process text image:", url, err.message);
    }
  }
}

// 主函数
async function main() {
  console.log("Processing existing tweets...\n");

  // 获取所有包含 URL 的推文
  const tweets = db.prepare("SELECT id, user, text FROM tweets WHERE text LIKE '%http%'").all();

  console.log("Found " + tweets.length + " tweets with URLs\n");

  for (const tweet of tweets) {
    console.log("\nProcessing tweet: " + tweet.id);
    console.log("User: " + tweet.user);
    console.log("Text: " + tweet.text);

    await handleTextImages(tweet.id, tweet.text);
  }

  console.log("\n✓ Done!");
}

main().catch(console.error);
