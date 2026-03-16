
# 文章内容获取功能

## 概述

这个功能允许你获取新闻页面的HTML内容，提取正文文本，并将详细内容存储到数据库中。这样你就可以查看完整的新闻内容，而不仅仅是摘要。

## 数据库结构

新增了 `articles` 表，包含以下字段：

- `id`: 文章唯一标识符
- `url`: 文章URL（唯一）
- `title`: 文章标题
- `content`: 文章正文内容
- `summary`: 文章摘要
- `source`: 文章来源（域名）
- `author`: 文章作者
- `published_at`: 文章发布时间
- `fetched_at`: 获取时间
- `digest_id`: 关联的摘要ID
- `metadata`: 元数据（JSON格式）
- `word_count`: 字数统计
- `language`: 文章语言

## 使用方法

### 1. 从摘要中获取所有文章

```bash
# 获取指定摘要ID的所有文章
npm run fetch-articles:digest 123

# 或者直接使用脚本
node scripts/fetch-articles.mjs --digest-id=123
```

### 2. 获取单个文章

```bash
# 获取指定URL的文章
npm run fetch-articles --url=https://example.com/article

# 或者直接使用脚本
node scripts/fetch-articles.mjs --url=https://example.com/article
```

### 3. 查询文章内容

使用SQLite命令行工具：

```bash
sqlite3 data/digest.db

# 查看所有文章
SELECT id, title, url, source, word_count FROM articles ORDER BY fetched_at DESC;

# 查看特定摘要的文章
SELECT * FROM articles WHERE digest_id = 123;

# 查看文章的详细内容
SELECT title, content FROM articles WHERE id = 1;

# 按来源统计文章数量
SELECT source, COUNT(*) as count FROM articles GROUP BY source ORDER BY count DESC;
```

## 功能特点

1. **自动去重**: 系统会检查URL是否已存在，避免重复获取
2. **智能提取**: 使用启发式方法提取文章主要内容
3. **元数据记录**: 记录获取时间、字数统计等信息
4. **关联摘要**: 文章与摘要关联，便于追踪来源
5. **错误处理**: 对获取失败的文章进行错误记录，不影响其他文章

## 注意事项

1. 某些网站可能有反爬虫机制，可能需要设置代理或User-Agent
2. 获取大量文章时，请注意遵守网站的robots.txt规则
3. 文章内容可能较大，存储时注意数据库大小
4. 建议定期清理不需要的文章数据

## 环境变量

可以通过设置环境变量来配置代理：

```bash
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=http://proxy.example.com:8080
```

## 示例

获取最新的4小时简报中的所有文章：

```bash
# 1. 查看最新的4小时简报ID
sqlite3 data/digest.db "SELECT id, created_at FROM digests WHERE type = '4h' ORDER BY created_at DESC LIMIT 1;"

# 2. 假设返回的ID是123，获取该摘要的所有文章
npm run fetch-articles:digest 123

# 3. 查看获取的文章
sqlite3 data/digest.db "SELECT id, title, url, word_count FROM articles WHERE digest_id = 123;"
```

## 数据库查询示例

```sql
-- 查看最新的10篇文章
SELECT id, title, url, source, word_count, fetched_at 
FROM articles 
ORDER BY fetched_at DESC 
LIMIT 10;

-- 查看字数最多的文章
SELECT id, title, url, word_count 
FROM articles 
ORDER BY word_count DESC 
LIMIT 5;

-- 查看特定来源的文章
SELECT * FROM articles WHERE source = 'www.example.com';

-- 搜索包含特定关键词的文章
SELECT id, title, url 
FROM articles 
WHERE content LIKE '%关键词%';

-- 统计每天获取的文章数量
SELECT DATE(fetched_at) as date, COUNT(*) as count 
FROM articles 
GROUP BY DATE(fetched_at) 
ORDER BY date DESC;
```
