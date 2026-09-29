#!/usr/bin/env bash
# shot.sh —— 截图小工具: 保存到项目 ui/ 目录
# 用法: bash tools/shot.sh <名字>   (ui/<名字>.png)
set -e
NAME="${1:-shot}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/ui"
mkdir -p "$DIR"
/c/Android/Sdk/platform-tools/adb.exe exec-out screencap -p > "$DIR/$NAME.png"
echo "$DIR/$NAME.png"
