#!/bin/bash
# 定时任务脚本，用于自动生成日报、周报和月报

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 生成4小时简报
generate_4h_digest() {
    cd "$PROJECT_ROOT"
    node scripts/generate-digests.mjs --type=4h
    echo "Generated 4h digest at $(date)"
}

# 生成日报
generate_daily_digest() {
    cd "$PROJECT_ROOT"
    node scripts/generate-digests.mjs --type=daily
    echo "Generated daily digest at $(date)"
}

# 生成周报
generate_weekly_digest() {
    cd "$PROJECT_ROOT"
    node scripts/generate-digests.mjs --type=weekly
    echo "Generated weekly digest at $(date)"
}

# 生成月报
generate_monthly_digest() {
    cd "$PROJECT_ROOT"
    node scripts/generate-digests.mjs --type=monthly
    echo "Generated monthly digest at $(date)"
}

# 根据参数执行不同的任务
case "$1" in
    4h)
        generate_4h_digest
        ;;
    daily)
        generate_daily_digest
        ;;
    weekly)
        generate_weekly_digest
        ;;
    monthly)
        generate_monthly_digest
        ;;
    all)
        generate_4h_digest
        generate_daily_digest
        generate_weekly_digest
        generate_monthly_digest
        ;;
    *)
        echo "Usage: $0 {4h|daily|weekly|monthly|all}"
        exit 1
        ;;
esac
