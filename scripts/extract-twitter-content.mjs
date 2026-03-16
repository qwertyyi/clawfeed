/**
 * 提取Twitter/X推文内容（备用方案，使用meta标签）
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
