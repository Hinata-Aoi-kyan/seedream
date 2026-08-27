#!/data/data/com.termux/files/usr/bin/bash
# Seedream Web 启动(常驻)
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 未找到 python3，请先运行:  pkg update && pkg install python -y"; exit 1
fi
echo "▶️  以后台常驻方式启动..."
bash manage.sh status >/dev/null 2>&1
bash manage.sh start
echo
echo "📌 提示: 结束请用  bash manage.sh stop ; 状态用  bash manage.sh status"
