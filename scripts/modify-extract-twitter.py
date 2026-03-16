import re

# 读取文件
with open("fetch-articles.mjs", "r", encoding="utf-8") as f:
    content = f.read()

# 定义要替换的模式
pattern = r"function extractTwitterContent\(html\) \{.*?^\}"

# 定义新的函数
new_function = """function extractTwitterContent(html) {
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
}"""

# 替换函数
new_content = re.sub(pattern, new_function, content, flags=re.MULTILINE | re.DOTALL)

# 写回文件
with open("fetch-articles.mjs", "w", encoding="utf-8") as f:
    f.write(new_content)

print("Done!")
