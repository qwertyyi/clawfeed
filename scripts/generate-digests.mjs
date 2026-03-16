#!/usr/bin/env node
/**
 * 自动生成日报、周报和月报的脚本
 * 
 * 使用方法:
 * node scripts/generate-digests.mjs --type=daily
 * node scripts/generate-digests.mjs --type=weekly
 * node scripts/generate-digests.mjs --type=monthly
 */

import { getDb, listSources, createDigest, getSource } from '../src/db.mjs';
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

// 获取数据库路径
const DB_PATH = process.env.DIGEST_DB || join(ROOT, 'data', 'digest.db');
const db = getDb(DB_PATH);

// HTTPS/HTTP 请求函数
function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const proxyUrl = env.HTTPS_PROXY || env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const headers = options.headers || {};
    if (proxyUrl) {
      const proxy = new URL(proxyUrl);
      const requestOptions = {
        host: proxy.hostname,
        port: proxy.port || 8080,
        path: url,
        headers: { ...headers, Host: new URL(url).hostname }
      };
      http.get(requestOptions, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }).on('error', reject);
    } else {
      const urlObj = new URL(url);
      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        headers: headers
      };
      https.get(requestOptions, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }).on('error', reject);
    }
  });
}

// 获取命令行参数
const args = process.argv.slice(2);
const typeArg = args.find(arg => arg.startsWith('--type='));
const reportType = typeArg ? typeArg.split('=')[1] : 'daily';

// 验证报告类型
const validTypes = ['4h', 'daily', 'weekly', 'monthly'];
if (!validTypes.includes(reportType)) {
  console.error(`Invalid report type: ${reportType}. Valid types are: ${validTypes.join(', ')}`);
  process.exit(1);
}

console.log(`Generating ${reportType} digest...`);

/**
 * 从 Hacker News 获取故事
 */
async function fetchHackerNewsStories(filterType = 'top', minScore = 100, limit = 30) {
  console.log(`Fetching Hacker News stories with filter: ${filterType}, min_score: ${minScore}`);

  // 获取故事 ID 列表
  let hnEndpoint;
  if (filterType === 'top') {
    hnEndpoint = 'https://hacker-news.firebaseio.com/v0/topstories.json';
  } else if (filterType === 'new') {
    hnEndpoint = 'https://hacker-news.firebaseio.com/v0/newstories.json';
  } else if (filterType === 'best') {
    hnEndpoint = 'https://hacker-news.firebaseio.com/v0/beststories.json';
  } else {
    hnEndpoint = 'https://hacker-news.firebaseio.com/v0/topstories.json';
  }

  let storyIdsResp;
  try {
    storyIdsResp = await httpsGet(hnEndpoint, {
      headers: {
        'User-Agent': 'ClawFeed/1.0'
      }
    });
  } catch (e) {
    console.error('Error fetching story IDs:', e);
    throw e;
  }

  if (storyIdsResp.status !== 200) {
    throw new Error(`Failed to fetch story IDs: ${storyIdsResp.status}`);
  }

  const storyIds = JSON.parse(storyIdsResp.body);
  const limitedStoryIds = storyIds.slice(0, limit);

  // 获取每个故事的详情
  const stories = [];
  for (const id of limitedStoryIds) {
    const itemEndpoint = `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
    try {
      const itemResp = await httpsGet(itemEndpoint, {
        headers: {
          'User-Agent': 'ClawFeed/1.0'
        }
      });

      if (itemResp.status === 200) {
        const item = JSON.parse(itemResp.body);
        if (item && item.score >= minScore) {
          stories.push(item);
        }
      }
    } catch (e) {
      console.error(`Error fetching story ${id}:`, e);
    }
  }

  console.log(`Successfully fetched ${stories.length} stories`);
  return stories;
}

/**
 * 从 Twitter 获取推文
 */
async function fetchTwitterTweets(handle, count = 10) {
  console.log(`Fetching tweets for handle: ${handle}`);

  // 注意: 这里需要实现 Twitter API 调用
  // 由于需要 API 密钥，这里只是一个占位符
  console.log(`Twitter API not implemented yet for handle: ${handle}`);
  return [];
}

/**
 * 从 RSS 源获取内容
 */
async function fetchRSSFeed(url) {
  console.log(`Fetching RSS feed from: ${url}`);

  try {
    const resp = await httpsGet(url, {
      headers: {
        'User-Agent': 'ClawFeed/1.0'
      }
    });

    if (resp.status !== 200) {
      throw new Error(`Failed to fetch RSS feed: ${resp.status}`);
    }

    const content = resp.body;
    // 这里可以添加 RSS 解析逻辑
    console.log(`Successfully fetched RSS feed from ${url}`);
    return { url, content };
  } catch (e) {
    console.error(`Error fetching RSS feed from ${url}:`, e);
    throw e;
  }
}

/**
 * 生成日报内容
 */
async function generateDailyDigest() {
  console.log('Generating daily digest...');

  // 获取所有活跃的数据源
  const sources = listSources(db, { includePublic: true });
  const activeSources = sources.filter(s => s.is_active);

  console.log(`Found ${activeSources.length} active sources`);

  // 获取 Hacker News 故事
  const hnSources = activeSources.filter(s => s.type === 'hackernews');
  let hnStories = [];

  for (const source of hnSources) {
    try {
      const config = typeof source.config === 'string' ? JSON.parse(source.config) : source.config;
      const stories = await fetchHackerNewsStories(config.filter || 'top', config.min_score || 100, 10);
      hnStories = hnStories.concat(stories);
    } catch (e) {
      console.error(`Error fetching stories from Hacker News source ${source.id}:`, e);
    }
  }

  // 获取 Twitter 推文
  const twitterSources = activeSources.filter(s => s.type === 'twitter_feed');
  let tweets = [];

  for (const source of twitterSources) {
    try {
      const config = typeof source.config === 'string' ? JSON.parse(source.config) : source.config;
      const handle = config.handle || '';
      if (handle) {
        const sourceTweets = await fetchTwitterTweets(handle, 5);
        tweets = tweets.concat(sourceTweets);
      }
    } catch (e) {
      console.error(`Error fetching tweets from Twitter source ${source.id}:`, e);
    }
  }

  // 获取 RSS 内容
  const rssSources = activeSources.filter(s => s.type === 'rss');
  let rssContents = [];

  for (const source of rssSources) {
    try {
      const config = typeof source.config === 'string' ? JSON.parse(source.config) : source.config;
      const url = config.url || '';
      if (url) {
        const rssContent = await fetchRSSFeed(url);
        rssContents.push(rssContent);
      }
    } catch (e) {
      console.error(`Error fetching RSS content from source ${source.id}:`, e);
    }
  }

  // 生成报告内容
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  let content = `# 📅 ${dateStr} 日报

`;

  // 添加 Hacker News 部分
  if (hnStories.length > 0) {
    content += `## 🔥 Hacker News 热门

`;
    hnStories.slice(0, 10).forEach((story, index) => {
      content += `${index + 1}. [${story.title}](${story.url || `https://news.ycombinator.com/item?id=${story.id}`}) - ${story.score} points
`;
    });
    content += `
`;
  }

  // 添加 Twitter 部分
  if (tweets.length > 0) {
    content += `## 🐦 Twitter 热门推文

`;
    tweets.slice(0, 5).forEach((tweet, index) => {
      content += `${index + 1}. ${tweet.text || 'No content'}
`;
    });
    content += `
`;
  }

  // 添加 RSS 部分
  if (rssContents.length > 0) {
    content += `## 📰 RSS 订阅

`;
    rssContents.forEach((rss, index) => {
      content += `### ${index + 1}. ${rss.url}
`;
      content += `${rss.content.substring(0, 200)}...

`;
    });
  }

  return content;
}

/**
 * 生成周报内容
 */
async function generateWeeklyDigest() {
  console.log('Generating weekly digest...');

  // 获取当前周的日期范围
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  const startDateStr = startOfWeek.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const endDateStr = endOfWeek.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  // 获取 Hacker News 故事
  const hnStories = await fetchHackerNewsStories('best', 200, 20);

  // 生成报告内容
  let content = `# 📅 ${startDateStr} - ${endDateStr} 周报

`;

  // 添加 Hacker News 部分
  if (hnStories.length > 0) {
    content += `## 🔥 Hacker News 本周精选

`;
    hnStories.slice(0, 15).forEach((story, index) => {
      content += `${index + 1}. [${story.title}](${story.url || `https://news.ycombinator.com/item?id=${story.id}`}) - ${story.score} points
`;
    });
    content += `
`;
  }

  return content;
}

/**
 * 生成月报内容
 */
async function generateMonthlyDigest() {
  console.log('Generating monthly digest...');

  // 获取当前月的日期范围
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const startDateStr = startOfMonth.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const endDateStr = endOfMonth.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  // 获取 Hacker News 故事
  const hnStories = await fetchHackerNewsStories('best', 500, 30);

  // 生成报告内容
  let content = `# 📅 ${startDateStr} - ${endDateStr} 月报

`;

  // 添加 Hacker News 部分
  if (hnStories.length > 0) {
    content += `## 🔥 Hacker News 本月精选

`;
    hnStories.slice(0, 20).forEach((story, index) => {
      content += `${index + 1}. [${story.title}](${story.url || `https://news.ycombinator.com/item?id=${story.id}`}) - ${story.score} points
`;
    });
    content += `
`;
  }

  return content;
}

/**
 * 主函数
 */
async function main() {
  try {
    let content;
    let createdAt;

    switch (reportType) {
      case '4h':
        // 4小时报告 - 从 tweets 表读取
        const now = new Date();
        const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

        content = `# 📅 ${dateStr} ${timeStr} 4小时简报

`;
        
        // 从数据库获取最近 4 小时的推文
        const tweets = db.prepare(`
          SELECT user, text, created_at
          FROM tweets
          WHERE datetime(created_at) > datetime('now', '-4 hours')
          ORDER BY created_at DESC
          LIMIT 50
        `).all();

        if (tweets.length > 0) {
          content += `## 🐦 最新推文

`;
          tweets.forEach((tweet, index) => {
            const tweetTime = new Date(tweet.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            content += `### ${tweetTime} @${tweet.user}
${tweet.text}

`;
          });
        } else {
          content += `## 🐦 最新推文

暂无新推文

`;
        }

        createdAt = now.toISOString();
        break;

      case 'daily':
        content = await generateDailyDigest();
        createdAt = new Date().toISOString();
        break;

      case 'weekly':
        content = await generateWeeklyDigest();
        createdAt = new Date().toISOString();
        break;

      case 'monthly':
        content = await generateMonthlyDigest();
        createdAt = new Date().toISOString();
        break;
    }

    // 保存到数据库
    const result = createDigest(db, {
      type: reportType,
      content,
      metadata: JSON.stringify({ generated_by: 'generate-digests.mjs' }),
      created_at: createdAt
    });

    console.log(`Successfully created ${reportType} digest with ID: ${result.id}`);
    process.exit(0);
  } catch (e) {
    console.error('Error generating digest:', e);
    process.exit(1);
  }
}

// 调用主函数
main().catch(err => {
  console.error('Unhandled error in main:', err);
  process.exit(1);
});
main();
