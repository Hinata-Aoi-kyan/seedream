# mock_api.py —— 排查 403 用的「窃听」服务器
# 作用: 模仿 ark 接口形状返回 200, 同时把每个请求的【方法/HTTP版本/请求头(保序)/请求体】
#       原样记录到 mock-log.jsonl, 用于精确对比 App(CapacitorHttp) 与 curl 的报文差异。
# 用法: python3 tools/mock_api.py [端口=8977]
#   模拟器里用 http://10.0.2.2:8977 访问本机; 本机 curl 用 http://127.0.0.1:8977
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = 'mock-log.jsonl'

CHAT_REPLY = {
    "id": "chatcmpl-mock",
    "object": "chat.completion",
    "created": int(time.time()),
    "model": "mock",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "mock ok"}, "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
}
MODELS = {"object": "list", "data": [{"id": "deepseek-v4-1-flash-260910", "object": "model", "owned_by": "mock"}]}


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'  # 与安卓 HttpURLConnection 行为一致, 便于观察 Content-Length

    def _record(self, body: bytes):
        rec = {
            "ts": round(time.time(), 3),
            "client": self.client_address[0],
            "method": self.command,
            "path": self.path,
            "http": self.request_version,
            # self.headers 保留到达顺序与原始大小写
            "headers": [[k, v] for k, v in self.headers.items()],
            "body_len": len(body),
            "body": body[:400].decode('utf-8', 'replace') if body else '',
        }
        line = json.dumps(rec, ensure_ascii=False)
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
        print('--- %s %s (%s) ---' % (self.command, self.path, self.request_version))
        for k, v in rec['headers']:
            print('  %s: %s' % (k, v))
        print('  body(%d): %s' % (len(body), rec['body'][:200]))
        sys.stdout.flush()

    def _reply(self, obj, status=200):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        if 'Origin' in self.headers:      # 跨域请求必须带回 ACAO, 否则浏览器拦截响应
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else b''
        self._record(body)
        p = self.path.split('?')[0]
        # /waf 前缀复刻真机症状: POST 且无 Origin(原生传输) -> 403; GET 与带 Origin 的(fetch 回退) -> 放行
        if p.startswith('/waf'):
            p = p[4:] or '/'
            if self.command == 'POST' and 'Origin' not in self.headers:
                self._reply({"error": {"code": "Forbidden", "message": "you do not have access to the requested resource", "param": "", "type": "Forbidden"}}, status=403)
                return
        if p == '/__dump':
            try:
                with open(LOG, 'rb') as f:
                    data = f.read()
            except OSError:
                data = b''
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-ndjson')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if p == '/__reset':
            open(LOG, 'w').close()
            self._reply({"ok": True})
            return
        if p.endswith('/models') and self.command == 'GET':
            self._reply(MODELS)
            return
        if p.endswith('/chat/completions') and self.command == 'POST':
            self._reply(CHAT_REPLY)
            return
        self._reply({"echo": True, "path": self.path, "method": self.command})

    do_GET = _handle
    do_POST = _handle
    do_PUT = _handle
    do_DELETE = _handle

    def do_OPTIONS(self):
        # 模拟 ark 的 CORS: 回显 Origin, 放行 authorization/content-type
        origin = self.headers.get('Origin', '*')
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,HEAD,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', self.headers.get('Access-Control-Request-Headers', 'authorization,content-type'))
        self.send_header('Content-Length', '0')
        self.end_headers()

    def log_message(self, *a):  # 静音默认访问日志(我们自己记)
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8977
    open(LOG, 'a').close()
    print('mock api on 0.0.0.0:%d  (模拟器访问: http://10.0.2.2:%d)' % (port, port))
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
