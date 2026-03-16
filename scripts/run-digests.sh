#!/bin/bash
# ClawFeed 摘要生成包装脚本

# 设置环境变量
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME="/Users/Zhuanz"
export USER="Zhuanz"
export LOGNAME="Zhuanz"
export SHELL="/bin/bash"

# 切换到项目目录
cd /Users/Zhuanz/Desktop/me/03-前端项目代码/xwzx-news/clawfeed || exit 1

# 记录开始时间
echo "Starting digest generation at $(date)"

# 使用完整路径运行 Node.js 脚本
/Users/Zhuanz/.nvm/versions/node/v20.19.0/bin/node scripts/generate-digests.mjs --type=4h

# 捕获脚本退出代码
EXIT_CODE=$?

# 记录退出代码
echo "Script exited with code: $EXIT_CODE"

# 返回脚本退出代码，但确保不超过 127（launchd 的最大退出代码）
if [ $EXIT_CODE -gt 127 ]; then
  exit 127
else
  exit $EXIT_CODE
fi
