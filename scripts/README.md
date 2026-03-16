# 自动生成日报、周报和月报

本目录包含用于自动生成日报、周报和月报的脚本。

## 文件说明

- `generate-digests.mjs` - 生成日报、周报和月报的主脚本
- `cron-digests.sh` - 用于定时任务的包装脚本

## 使用方法

### 手动生成报告

```bash
# 生成4小时简报
node scripts/generate-digests.mjs --type=4h

# 生成日报
node scripts/generate-digests.mjs --type=daily

# 生成周报
node scripts/generate-digests.mjs --type=weekly

# 生成月报
node scripts/generate-digests.mjs --type=monthly
```

或使用包装脚本：

```bash
# 生成4小时简报
bash scripts/cron-digests.sh 4h

# 生成日报
bash scripts/cron-digests.sh daily

# 生成周报
bash scripts/cron-digests.sh weekly

# 生成月报
bash scripts/cron-digests.sh monthly

# 生成所有报告
bash scripts/cron-digests.sh all
```

## 设置定时任务

### Linux/macOS (使用 cron)

1. 编辑 crontab 文件：
   ```bash
   crontab -e
   ```

2. 添加以下定时任务（根据需要调整时间）：
   ```bash
   # 每4小时生成一次4小时简报
   0 */4 * * * cd /path/to/clawfeed && bash scripts/cron-digests.sh 4h >> logs/digests.log 2>&1

   # 每天早上8点生成日报
   0 8 * * * cd /path/to/clawfeed && bash scripts/cron-digests.sh daily >> logs/digests.log 2>&1

   # 每周一早上9点生成周报
   0 9 * * 1 cd /path/to/clawfeed && bash scripts/cron-digests.sh weekly >> logs/digests.log 2>&1

   # 每月1号早上10点生成月报
   0 10 1 * * cd /path/to/clawfeed && bash scripts/cron-digests.sh monthly >> logs/digests.log 2>&1
   ```

### macOS (使用 launchd)

1. 创建 plist 文件：
   ```bash
   sudo nano /Library/LaunchDaemons/com.clawfeed.digests.plist
   ```

2. 添加以下内容：
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key>
       <string>com.clawfeed.digests</string>
       <key>ProgramArguments</key>
       <array>
           <string>/bin/bash</string>
           <string>/path/to/clawfeed/scripts/cron-digests.sh</string>
           <string>all</string>
       </array>
       <key>StartInterval</key>
       <integer>14400</integer> <!-- 4小时 -->
       <key>RunAtLoad</key>
       <true/>
       <key>StandardOutPath</key>
       <string>/path/to/clawfeed/logs/digests.log</string>
       <key>StandardErrorPath</key>
       <string>/path/to/clawfeed/logs/digests.log</string>
   </dict>
   </plist>
   ```

3. 加载服务：
   ```bash
   sudo launchctl load /Library/LaunchDaemons/com.clawfeed.digests.plist
   ```

## 日志

定时任务的日志会输出到 `logs/digests.log` 文件中。如果需要查看日志：

```bash
tail -f logs/digests.log
```

## 注意事项

1. 确保 Node.js 已安装并可在系统路径中访问
2. 确保数据库文件路径正确
3. 确保脚本有执行权限：
   ```bash
   chmod +x scripts/cron-digests.sh
   ```
4. 如果使用 cron，请确保使用绝对路径
5. 首次运行前，确保已创建日志目录：
   ```bash
   mkdir -p logs
   ```
