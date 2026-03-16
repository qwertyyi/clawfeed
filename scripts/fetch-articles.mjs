
/**
 * 获取新闻页面的HTML内容并提取正文
 *
 * 使用方法:
 * node scripts/fetch-articles.mjs --digest-id=123
 * node scripts/fetch-articles.mjs --url=https://example.com/article
 */

import { getDb, createArticle, getArticleByUrl, getDigest } from '../src/db.mjs';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

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

// Twitter API Bearer Token
const TWITTER_BEARER_TOKEN = env.TWITTER_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;

// 请求延迟（毫秒）
const REQUEST_DELAY = parseInt(env.REQUEST_DELAY || process.env.REQUEST_DELAY || '2000');

// 重试次数
const MAX_RETRIES = parseInt(env.MAX_RETRIES || process.env.MAX_RETRIES || '3');

// 重试延迟（毫秒）
const RETRY_DELAY = parseInt(env.RETRY_DELAY || process.env.RETRY_DELAY || '5000');

// 获取数据库路径
const DB_PATH = process.env.DIGEST_DB || join(ROOT, 'data', 'digest.db');
const db = getDb(DB_PATH);

// 延迟函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 带重试的请求函数
async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetchPage(url, options);
      
      // 如果不是 429 错误，直接返回
      if (response.status !== 429) {
        return response;
      }
      
      // 如果是 429 错误，等待后重试
      console.log(`Rate limited (429), retrying in ${RETRY_DELAY}ms... (${i + 1}/${retries})`);
      await sleep(RETRY_DELAY);
    } catch (error) {
      // 如果是最后一次重试，抛出错误
      if (i === retries - 1) {
        throw error;
      }
      console.log(`Request failed, retrying in ${RETRY_DELAY}ms... (${i + 1}/${retries})`);
      await sleep(RETRY_DELAY);
    }
  }
  
  throw new Error(`Max retries (${retries}) exceeded`);
}

// HTTPS/HTTP 请求函数，支持重定向
function fetchPage(url, options = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const proxyUrl = env.HTTPS_PROXY || env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const headers = options.headers || {};

    const makeRequest = (requestUrl, redirectCount = 0) => {
      if (proxyUrl) {
        const proxy = new URL(proxyUrl);
        const requestOptions = {
          host: proxy.hostname,
          port: proxy.port || 8080,
          path: requestUrl,
          headers: { ...headers, Host: new URL(requestUrl).hostname }
        };
        http.get(requestOptions, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirectCount >= maxRedirects) {
              reject(new Error(`Too many redirects for ${requestUrl}`));
              return;
            }
            const redirectUrl = new URL(res.headers.location, requestUrl).toString();
            console.log(`Redirecting to: ${redirectUrl}`);
            makeRequest(redirectUrl, redirectCount + 1);
          } else {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers, finalUrl: requestUrl }));
          }
        }).on('error', reject);
      } else {
        const urlObj = new URL(requestUrl);
        const requestOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            ...headers
          }
        };
        const client = urlObj.protocol === 'https:' ? https : http;
        client.get(requestOptions, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirectCount >= maxRedirects) {
              reject(new Error(`Too many redirects for ${requestUrl}`));
              return;
            }
            const redirectUrl = new URL(res.headers.location, requestUrl).toString();
            console.log(`Redirecting to: ${redirectUrl}`);
            makeRequest(redirectUrl, redirectCount + 1);
          } else {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers, finalUrl: requestUrl }));
          }
        }).on('error', reject);
      }
    };

    makeRequest(url);
  });
}

/**
 * 提取文章正文
 * 使用简单的启发式方法提取主要内容
 */
function extractArticleContent(html, url) {
  try {
    // 移除script和style标签
    let cleanHtml = html.replace(/<script[^>]*>.*?<\/script>/gis, '')
                        .replace(/<style[^>]*>.*?<\/style>/gis, '')
                        .replace(/<nav[^>]*>.*?<\/nav>/gis, '')
                        .replace(/<footer[^>]*>.*?<\/footer>/gis, '')
                        .replace(/<header[^>]*>.*?<\/header>/gis, '');

    // 尝试提取主要内容区域
    const contentPatterns = [
      /<article[^>]*>([\s\S]*?)<\/article>/i,
      /<main[^>]*>([\s\S]*?)<\/main>/i,
      /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*class=["'][^"']*post[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*class=["'][^"']*article[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    ];

    let content = '';
    for (const pattern of contentPatterns) {
      const match = cleanHtml.match(pattern);
      if (match && match[1] && match[1].length > 500) {
        content = match[1];
        break;
      }
    }

    // 如果没有找到特定的内容区域，使用整个body
    if (!content) {
      const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) {
        content = bodyMatch[1];
      } else {
        content = cleanHtml;
      }
    }

    // 提取标题
    const titlePatterns = [
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ];

    let title = '';
    for (const pattern of titlePatterns) {
      const match = cleanHtml.match(pattern);
      if (match && match[1]) {
        title = match[1].replace(/<[^>]*>/g, '').trim();
        if (title.length > 0) break;
      }
    }

    // 提取发布时间
    const publishedAtPatterns = [
      /<time[^>]*datetime=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]*name=["']date["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]*name=["']pubdate["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]*name=["']publishdate["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]*property=["']og:article:published_time["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]*itemprop=["']datePublished["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<span[^>]*class=["'][^"']*date[^"']*["'][^>]*>([^<]+)<\/span>/i,
      /<div[^>]*class=["'][^"']*date[^"']*["'][^>]*>([^<]+)<\/div>/i,
    ];

    let publishedAt = '';
    for (const pattern of publishedAtPatterns) {
      const match = cleanHtml.match(pattern);
      if (match && match[1]) {
        publishedAt = match[1].trim();
        // 尝试解析日期并转换为ISO格式
        try {
          const date = new Date(publishedAt);
          if (!isNaN(date.getTime())) {
            publishedAt = date.toISOString();
            break;
          }
        } catch (e) {
          // 如果解析失败，保持原样
        }
      }
    }

    // 清理HTML标签，保留文本
    const textContent = content.replace(/<[^>]*>/g, ' ')
                               .replace(/\s+/g, ' ')
                               .trim();

    // 生成摘要（前500个字符）
    const summary = textContent.substring(0, 500);

    return {
      title,
      content: textContent,
      summary,
      html: content,
      publishedAt
    };
  } catch (error) {
    console.error(`Error extracting content from ${url}:`, error);
    return {
      title: '',
      content: '',
      summary: '',
      html: ''
    };
  }
}

/**
 * 处理Twitter/X链接
 * Twitter/X链接通常重定向到fxtwitter.com或vxtwitter.com等镜像服务
 */
/**
 * 从URL中提取Tweet ID
 */
function extractTweetId(url) {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * 使用Twitter官方JSON接口获取推文数据
 */
async function fetchTweetJson(tweetId) {
  console.log(`TWITTER_BEARER_TOKEN is ${TWITTER_BEARER_TOKEN ? 'set' : 'not set'}`);
  // 优先使用 Twitter API v2（需要 Bearer Token）
  if (TWITTER_BEARER_TOKEN) {
    const url = `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=created_at,author_id,public_metrics,entities,source`;
    try {
      const response = await fetchWithRetry(url, {
        headers: {
          'Authorization': `Bearer ${TWITTER_BEARER_TOKEN}`
        }
      });

      if (response.status === 200) {
        try {
          const data = JSON.parse(response.body);
          return data.data;
        } catch (error) {
          throw new Error(`Failed to parse tweet JSON: ${error.message}`);
        }
      } else {
        console.log(`Twitter API v2 failed with status ${response.status}, falling back to syndication API`);
      }
    } catch (error) {
      console.log(`Twitter API v2 error: ${error.message}, falling back to syndication API`);
    }
  }

  // 回退到 syndication API（也使用重试机制）
  const url = `https://cdn.syndication.twimg.com/tweet?id=${tweetId}`;
  const response = await fetchWithRetry(url);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch tweet JSON: ${response.status}`);
  }

  try {
    return JSON.parse(response.body);
  } catch (error) {
    throw new Error(`Failed to parse tweet JSON: ${error.message}`);
  }
}

/**
 * 提取Twitter/X推文内容
 */
function extractTwitterContent(html) {
  try {
    // 使用meta标签提取推文内容（更稳定）
    const textMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
    const authorMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
    const timeMatch = html.match(/<meta property="article:published_time" content="([^"]+)"/);

    return {
      content: textMatch ? textMatch[1] : "",
      author: authorMatch ? authorMatch[1] : "",
      publishedAt: timeMatch ? timeMatch[1] : "",
      summary: textMatch ? textMatch[1].substring(0, 500) : ""
    };
  } catch (error) {
    console.error("Error extracting Twitter content:", error);
    return {
      content: "",
      author: "",
      publishedAt: "",
      summary: ""
    };
  }
}

/**
 * 获取并存储文章内容
 */
async function fetchAndStoreArticle(url, digestId = null) {
  try {
    // 检查是否已存在
    const existing = getArticleByUrl(db, url);
    if (existing) {
      console.log(`Article already exists: ${url}`);
      return existing;
    }

    console.log(`Fetching article: ${url}`);
    
    // 处理Twitter/X链接
    const tweetId = extractTweetId(url);
    const isTwitter = tweetId !== null;
    
    // 提取内容
    let title, content, summary, author, publishedAt;
    
    if (isTwitter) {
      // 使用Twitter官方JSON接口获取推文数据
      try {
        const tweet = await fetchTweetJson(tweetId);
        content = tweet.text;
        author = tweet.user.screen_name;
        publishedAt = tweet.created_at;
        summary = tweet.text.substring(0, 500);
        title = `Tweet by ${author}`;
      } catch (error) {
        console.error(`Failed to fetch tweet JSON, falling back to HTML: ${error.message}`);
        // 如果JSON接口失败，回退到HTML解析
        const username = url.split('/')[3];
        const processedUrl = `https://vxtwitter.com/${username}/status/${tweetId}`;
        const response = await fetchPage(processedUrl);
        if (response.status === 200) {
          const twitterData = extractTwitterContent(response.body);
          content = twitterData.content;
          author = twitterData.author;
          publishedAt = twitterData.publishedAt;
          summary = twitterData.summary;
          title = `Tweet by ${author}`;
        } else {
          throw new Error(`Failed to fetch tweet: ${response.status}`);
        }
      }
    } else {
      // 使用通用内容提取
      const response = await fetchPage(url);
      if (response.status !== 200) {
        throw new Error(`Failed to fetch article: ${response.status}`);
      }
      const extracted = extractArticleContent(response.body, url);
      title = extracted.title;
      content = extracted.content;
      summary = extracted.summary;
      publishedAt = extracted.publishedAt || "";
      author = "";
    }

    // 存储到数据库
    const result = createArticle(db, {
      url,
      title,
      content,
      summary,
      author,
      publishedAt,
      digestId,
      source: new URL(url).hostname,
      metadata: JSON.stringify({
        content_length: content.length,
        fetched_at: new Date().toISOString(),
        is_twitter: isTwitter
      })
    });

    console.log(`Successfully stored article: ${result.id}`);
    return result;
  } catch (error) {
    console.error(`Error processing article ${url}:`, error);
    throw error;
  }
}

/**
 * 从摘要中提取URL并获取文章
 */
async function fetchArticlesFromDigest(digestId) {
  try {
    const digest = getDigest(db, digestId);
    if (!digest) {
      throw new Error(`Digest not found: ${digestId}`);
    }

    // 从摘要内容中提取URL
    const urlRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const urls = [];
    let match;

    while ((match = urlRegex.exec(digest.content)) !== null) {
      urls.push({
        title: match[1],
        url: match[2]
      });
    }

    console.log(`Found ${urls.length} URLs in digest ${digestId}`);

    // 获取并存储每篇文章
    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const { url, title } = urls[i];
      try {
        // 跳过Hacker News讨论链接
        if (url.includes('news.ycombinator.com')) {
          console.log(`Skipping Hacker News discussion: ${url}`);
          continue;
        }

        const article = await fetchAndStoreArticle(url, digestId);
        results.push(article);
        
        // 在获取每篇文章之间添加延迟，避免触发速率限制
        if (i < urls.length - 1) {
          console.log(`Waiting ${REQUEST_DELAY}ms before next request...`);
          await sleep(REQUEST_DELAY);
        }
      } catch (error) {
        console.error(`Failed to fetch article ${url}:`, error);
      }
    }

    console.log(`Successfully fetched ${results.length} articles`);
    return results;
  } catch (error) {
    console.error(`Error fetching articles from digest ${digestId}:`, error);
    throw error;
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    const digestIdArg = args.find(arg => arg.startsWith('--digest-id='));
    const urlArg = args.find(arg => arg.startsWith('--url='));

    if (digestIdArg) {
      const digestId = parseInt(digestIdArg.split('=')[1]);
      await fetchArticlesFromDigest(digestId);
    } else if (urlArg) {
      const url = urlArg.split('=')[1];
      await fetchAndStoreArticle(url);
    } else {
      console.error('Please specify either --digest-id or --url');
      process.exit(1);
    }

    console.log('Done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unhandled error in main:', err);
  process.exit(1);
});
