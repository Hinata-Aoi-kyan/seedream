#!/usr/bin/env bash
# dev-loop.sh —— 改完即跑: 重新收集网页资源 → 编译 → 装包 → 启动
# 用法: bash tools/dev-loop.sh [BUILD_VERSION]
set -e
cd "$(dirname "$0")/.."
export JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
export ANDROID_HOME='C:\Android\Sdk' ANDROID_SDK_ROOT='C:\Android\Sdk'
export PATH="/c/Android/Sdk/platform-tools:$PATH"
export BUILD_VERSION="${1:-dev}" BUILD_CODE="${1:-dev}"
[ "$BUILD_CODE" = "dev" ] && BUILD_CODE=9999
node scripts/prepare-www.mjs >/dev/null
npx cap sync android >/dev/null
( cd android && ./gradlew assembleDebug --no-daemon -q >/dev/null )
adb install -r android/app/build/outputs/apk/debug/app-debug.apk | tail -1
adb shell monkey -p com.seedream.webapp -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
echo "[dev-loop] 完成 v$BUILD_VERSION"
