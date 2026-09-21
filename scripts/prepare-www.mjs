/**
 * 把网页文件收集到 www/ 供 Capacitor 打包。
 * 单一来源: 仓库根目录的 index.html / static/ / manifest.json / sw.js / providers.default.json
 * 同时注入构建标记(版本/提交/时间), 便于在 App 里确认装的是哪一版。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');

const FILES = ['index.html', 'manifest.json', 'sw.js', 'providers.default.json'];
const DIRS = ['static'];

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.warn('[prepare-www] 跳过(不存在):', f); continue; }
  fs.copyFileSync(src, path.join(WWW, f));
  console.log('[prepare-www] 复制', f);
}
for (const d of DIRS) {
  const src = path.join(ROOT, d);
  if (!fs.existsSync(src)) { console.warn('[prepare-www] 跳过(不存在):', d); continue; }
  fs.cpSync(src, path.join(WWW, d), { recursive: true });
  console.log('[prepare-www] 复制', d + '/');
}

// ---- 注入构建标记 ----
const version = process.env.BUILD_VERSION || 'dev';
const sha = (process.env.GITHUB_SHA || 'local').slice(0, 7);
const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
const stamp = `v${version} · ${sha} · ${when}`;
const idx = path.join(WWW, 'index.html');
let html = fs.readFileSync(idx, 'utf8');
const META_RE = /<meta\s+name="build-stamp"[^>]*>\s*/i;
html = html.replace(META_RE, '');                       // 先清旧的, 保证幂等
if (html.includes('<head>')) {
  html = html.replace('<head>', `<head>\n<meta name="build-stamp" content="${stamp}">`);
  fs.writeFileSync(idx, html);
  console.log('[prepare-www] 构建标记:', stamp);
} else {
  console.warn('[prepare-www] 未找到 <head>, 跳过构建标记');
}

console.log('[prepare-www] 完成 ->', WWW);
