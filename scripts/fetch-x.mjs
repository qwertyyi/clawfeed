

console.log("fetch-x script started");
import { chromium } from 'playwright';
import { getDb, createArticle } from '../src/db.mjs';

const db = getDb("data/digest.db");

async function fetchUserTweets(username){

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  await page.goto(`https://x.com/${username}`);

  await page.waitForSelector("article");

  const tweets = await page.$$eval("article", nodes =>

    nodes.slice(0,5).map(n=>{

      const text = n.innerText;

      const link = n.querySelector("a[href*='/status/']");

      const url = link ? "https://x.com"+link.getAttribute("href") : "";

      return {text,url};

    })

  );

  await browser.close();

  return tweets;

}

async function saveTweets(username){

  const tweets = await fetchUserTweets(username);

  for(const t of tweets){

    const title = `Tweet by ${username}`;

    const summary = t.text.slice(0,200);

    await createArticle(db,{
      url: t.url,
      title,
      content: t.text,
      summary,
      author: username,
      source: "x.com"
    });

    console.log("saved:", t.url);

  }

}

async function main(){

  const users = [
    "elonmusk",
    "sama",
    "karpathy",
    "naval"
  ];

  for(const u of users){

    console.log("fetching",u);

    await saveTweets(u);

  }

}

main();