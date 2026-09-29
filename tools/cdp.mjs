#!/usr/bin/env node
// cdp.mjs —— 通过 adb + Chrome DevTools Protocol 在 App 的 WebView 里执行 JS
// 依赖: capacitor.config.json 里 webContentsDebuggingEnabled=true (debug 包默认也开)
// 用法:
//   node tools/cdp.mjs "1+1"                     在 App 页面里求值并打印结果
//   node tools/cdp.mjs --file tools/snippet.js   执行文件内容
// 原理: adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
//       GET /json 找到 App 页面 -> WebSocket -> Runtime.evaluate(awaitPromise)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const ADB = process.env.ADB || 'adb';
const expr = process.argv[2] === '--file' ? fs.readFileSync(process.argv[3], 'utf8') : process.argv[2];
if (!expr) { console.error('用法: node tools/cdp.mjs "<js 表达式>" | --file <path>'); process.exit(2); }

// 1. 找 App 进程的 webview 调试 socket
const serial = process.env.ANDROID_SERIAL;               // 多设备时指定
const adbArgs = (a) => (serial ? ['-s', serial, ...a] : a);
const pkg = process.env.APP_PKG || 'com.seedream.webapp';
const cdpPort = process.env.CDP_PORT || '9222';   // 注意避开 Windows Hyper-V 保留端口段
const pid = execFileSync(ADB, adbArgs(['shell', 'pidof', pkg])).toString().trim();
if (!pid) { console.error('App 未运行:', pkg); process.exit(1); }
const sockName = 'webview_devtools_remote_' + pid;
execFileSync(ADB, adbArgs(['forward', 'tcp:' + cdpPort, 'localabstract:' + sockName]));

// 2. 列出页面
const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
const page = list.find((t) => t.type === 'page' && /^(https?:)?\/\/localhost|capacitor:\/\//.test(t.url)) || list.find((t) => t.type === 'page');
if (!page) { console.error('找不到 WebView 页面, 目标列表:', JSON.stringify(list.map((t) => [t.type, t.url]))); process.exit(1); }
console.error('[cdp] 页面:', page.url);

// 3. WebSocket -> Runtime.evaluate
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const out = await new Promise((res, rej) => {
  const id = 1;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id === id) { res(m); ws.close(); }
  };
  ws.onerror = rej;
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
});
const r = out.result || {};
if (r.exceptionDetails) {
  console.log('EXCEPTION: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 2000));
  process.exit(1);
}
const val = r.result?.value;
console.log(typeof val === 'string' ? val : JSON.stringify(val, null, 2));
