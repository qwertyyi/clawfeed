import { getDb } from '../src/db.mjs';
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// 基础配置
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
// 代理地址（替换为你的有效代理）
const proxyUrl = 'http://127.0.0.1:7897';
// 仅爬取马斯克，固定配置
const TARGET_USER = {
  username: 'elonmusk',
  displayName: 'Elon Musk'
};
// 默认爬取日期
const DEFAULT_DATE = '2024-03-16';

// 数据库初始化
const db = getDb(join(ROOT, "data", "digest.db"));
db.exec(`CREATE TABLE IF NOT EXISTS tweets (
  id TEXT PRIMARY KEY,
  user TEXT,
  text TEXT,
  created_at TEXT
)`);

/**
 * 爬取马斯克推文（强制使用本地 Chrome 浏览器）
 * @param {string} targetDate 目标日期
 * @returns {Array} 推文列表
 */
async function fetchElonMuskTweets(targetDate) {
  // ======================== 核心修改：使用本地谷歌浏览器（Chrome）========================
  // 1. 先找到本地 Chrome 路径（Playwright 会自动检测，也可手动指定）
  // 手动指定 Chrome 路径示例（根据你的系统修改）：
  // Mac: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  // Windows: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const chromeExecutablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  // 2. 启动本地 Chrome（而非 Playwright 自带的 Chromium）
  const browser = await chromium.launch({
    headless: false, // 显示浏览器窗口（便于调试）
    slowMo: 500,     // 慢动作，模拟真人操作
    executablePath: chromeExecutablePath, // 强制使用本地 Chrome
    proxy: {
      server: proxyUrl, // 代理配置
    },
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled', // 禁用自动化检测
      '--disable-web-security',
      '--ignore-certificate-errors',
      '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    ]
  });

  // 创建浏览器上下文（模拟真实用户）
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'UTC',
    viewport: { width: 1280, height: 800 },
    javaScriptEnabled: true,
    acceptDownloads: false
  });

  const page = await context.newPage();
  const tweets = [];

  try {
    const userUrl = `https://twitter.com/${TARGET_USER.username}`;
    console.log(`  🌐 访问马斯克主页: ${userUrl}`);

    // 页面加载（带重试 + 宽松的加载策略）
    let pageLoaded = false;
    let retryCount = 0;
    while (!pageLoaded && retryCount < 2) {
      try {
        await page.goto(userUrl, {
          waitUntil: 'domcontentloaded', // DOM加载完成即停止（避免超时）
          timeout: 120000 // 超时时间 120 秒
        });
        pageLoaded = true;
      } catch (e) {
        retryCount++;
        console.log(`  ⚠️  页面加载失败，重试第 ${retryCount} 次...`);
        await page.waitForTimeout(5000);
      }
    }
    if (!pageLoaded) {
      throw new Error(`Chrome 加载页面超时（代理：${proxyUrl}）`);
    }

    // 处理人机验证/登录提示
    const hasCaptcha = await page.waitForSelector(
      'iframe[src*="captcha"], div[data-testid="ocfEnterTextText"]',
      { timeout: 10000 }
    ).catch(() => false);

    if (hasCaptcha) {
      console.log(`  ⚠️  检测到验证，请手动完成后按回车继续...`);
      await new Promise(resolve => process.stdin.once('data', resolve));
    }

    // 日期筛选参数（封装为单对象，避免参数超限）
    const filterParams = {
      start: new Date(`${targetDate}T00:00:00Z`).getTime(),
      end: new Date(`${targetDate}T23:59:59Z`).getTime()
    };

    // 滚动爬取推文（最多 8 次滚动）
    for (let scrollCount = 1; scrollCount <= 8; scrollCount++) {
      // 提取推文（Chrome 浏览器上下文执行）
      const pageTweets = await page.evaluate((params) => {
        const tweetList = [];
        // 适配 Chrome 中 X/Twitter 的最新元素结构
        const tweetElements = document.querySelectorAll('div[data-testid="cellInnerDiv"] article');

        tweetElements.forEach(el => {
          try {
            // 提取推文 ID
            const statusLink = el.querySelector('a[href*="/status/"]');
            if (!statusLink) return;
            const tweetId = statusLink.href.split('/status/')[1]?.split('?')[0];
            if (!tweetId || tweetList.some(t => t.id === tweetId)) return;

            // 提取发布时间（时间戳对比）
            const timeElement = el.querySelector('time');
            if (!timeElement) return;
            const tweetTime = new Date(timeElement.dateTime || timeElement.getAttribute('datetime'));
            const tweetTimeStamp = tweetTime.getTime();
            if (tweetTimeStamp < params.start || tweetTimeStamp > params.end) return;

            // 提取推文文本
            const textElement = el.querySelector('div[data-testid="tweetText"]') || el.querySelector('div[dir="auto"]');
            const tweetText = textElement ? textElement.textContent.trim() : '';
            if (!tweetText) return;

            // 封装推文数据
            tweetList.push({
              id: tweetId,
              text: tweetText,
              created_at: tweetTime.toISOString()
            });
          } catch (e) {
            // 忽略单条推文提取错误
            return;
          }
        });

        return tweetList;
      }, filterParams); // 仅传 1 个参数，符合 Playwright 规则

      // 合并推文（去重）
      pageTweets.forEach(tweet => {
        if (!tweets.some(t => t.id === tweet.id)) {
          tweets.push({
            ...tweet,
            user: TARGET_USER.displayName // 固定为马斯克
          });
        }
      });

      // 日志输出
      console.log(`  📜 Chrome 滚动 ${scrollCount}: 累计找到 ${tweets.length} 条马斯克推文`);

      // 滚动页面加载更多
      await page.evaluate(() => {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: 'smooth' // 模拟真人平滑滚动
        });
      });

      // 等待加载
      await page.waitForTimeout(4000);

      // 提前停止：连续 2 次无新推文
      if (scrollCount > 2 && pageTweets.length === 0) {
        console.log(`  🛑 无新推文，提前停止滚动`);
        break;
      }
    }

  } catch (error) {
    console.error(`  ❌ 爬取马斯克推文失败: ${error.message}`);
  } finally {
    // 关闭 Chrome 浏览器
    await browser.close();
    console.log(`  ✅ Chrome 爬取完成，共找到 ${tweets.length} 条马斯克 ${targetDate} 的推文`);
  }

  return tweets;
}

/**
 * 保存马斯克推文到数据库
 * @param {Array} tweets 推文列表
 * @returns {number} 新增保存数量
 */
function saveElonMuskTweets(tweets) {
  let savedCount = 0;

  if (tweets.length === 0) return savedCount;

  // 事务插入，提升效率
  db.transaction(() => {
    for (const tweet of tweets) {
      // 检查是否已存在
      const exists = db.prepare("SELECT id FROM tweets WHERE id=?").get(tweet.id);
      if (exists) continue;

      // 插入数据库
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO tweets (id, user, text, created_at)
        VALUES (?,?,?,?)
      `);

      stmt.run(tweet.id, tweet.user, tweet.text, tweet.created_at);
      savedCount++;
    }
  });

  return savedCount;
}

/**
 * 主函数：仅爬取马斯克，默认日期，使用 Chrome
 */
async function main() {
  console.log("🚀 马斯克推文爬虫启动（使用谷歌 Chrome 浏览器）");
  console.log("==============================================");
  
  // 获取命令行日期参数，无参数则用默认值
  const args = process.argv.slice(2);
  const targetDate = args[0] || DEFAULT_DATE;
  console.log(`📅 爬取日期: ${targetDate}\n`);

  // 仅爬取马斯克
  console.log(`🔍 开始爬取马斯克（@elonmusk）的推文...`);
  const tweets = await fetchElonMuskTweets(targetDate);
  const savedCount = saveElonMuskTweets(tweets);
  
  // 最终结果输出
  console.log("\n📊 爬取结果汇总:");
  console.log(`   - 找到推文总数: ${tweets.length}`);
  console.log(`   - 新增保存推文: ${savedCount}`);
  console.log("\n✅ 马斯克推文爬取任务完成！");
}

// 执行主函数
main().catch(err => {
  console.error('💥 全局错误:', err.message);
  process.exit(1);
});