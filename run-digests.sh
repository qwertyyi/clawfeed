export PATH="/Users/Zhuanz/.nvm/versions/node/v20.19.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_PATH="/Users/Zhuanz/.nvm/versions/node/v20.19.0/lib/node_modules"
cd /Users/Zhuanz/Desktop/me/03-前端项目代码/xwzx-news/clawfeed
/Users/Zhuanz/.nvm/versions/node/v20.19.0/bin/node /Users/Zhuanz/Desktop/me/03-前端项目代码/xwzx-news/clawfeed/scripts/generate-digests.mjs --type=4h
exit_code=$?
echo "Script exited with code: $exit_code" >> /Users/Zhuanz/Desktop/me/03-前端项目代码/xwzx-news/clawfeed/logs/digests.log
exit $exit_code
