/**
 * 把网页文件收集到 www/ 供 Capacitor 打包。
 * 单一来源: 仓库根目录的 index.html / static/ / manifest.json / sw.js
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
console.log('[prepare-www] 完成 ->', WWW);
