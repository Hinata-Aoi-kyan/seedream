#!/data/data/com.termux/files/usr/bin/bash
# Seedream Web 常驻管理: bash manage.sh start|stop|restart|status
cd "$(dirname "$0")"
PORT=${PORT:-8765}
PID=server.pid
LOG=server.log
case "$1" in
  start)
    if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
      echo "已在运行 (PID $(cat "$PID")) -> http://localhost:$PORT"; exit 0
    fi
    echo "启动网关(后台常驻)..."
    nohup python3 gateway.py > "$LOG" 2>&1 &
    echo $! > "$PID"
    sleep 2
    echo "已启动 PID $(cat "$PID") -> 浏览器打开 http://localhost:$PORT"
    cat "$LOG"
    ;;
  stop)
    if [ -f "$PID" ]; then
      kill "$(cat "$PID")" 2>/dev/null; rm -f "$PID"
      echo "已停止"
    else echo "未运行"; fi
    ;;
  restart) bash "$0" stop; sleep 1; bash "$0" start ;;
  status)
    if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
      echo "运行中 (PID $(cat "$PID")) -> http://localhost:$PORT"
    else echo "未运行"; fi
    ;;
  *) echo "用法: bash manage.sh start|stop|restart|status";;
esac
