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

# 使用完整路径运行 Node.js 脚本
/Users/Zhuanz/.nvm/versions/node/v20.19.0/bin/node scripts/generate-digests.mjs --type=4h
