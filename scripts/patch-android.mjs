/**
 * 给 `npx cap add android` 生成的工程打补丁。
 * 幂等: 重复执行不会重复插入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'android/app/src/main/AndroidManifest.xml');
const STRINGS = path.join(ROOT, 'android/app/src/main/res/values/strings.xml');

if (!fs.existsSync(MANIFEST)) {
  console.error('[patch] 找不到 AndroidManifest.xml:', MANIFEST);
  process.exit(1);
}

let xml = fs.readFileSync(MANIFEST, 'utf8');
const before = xml;

/** 需要的权限 */
const PERMS = [
  ['android.permission.INTERNET', '访问网络(调用生图接口)'],
  ['android.permission.POST_NOTIFICATIONS', 'Android 13+ 通知权限(生成完成提醒)'],
  ['android.permission.READ_MEDIA_IMAGES', 'Android 13+ 读取相册'],
  ['android.permission.WRITE_EXTERNAL_STORAGE', '旧版 Android 写相册'],
];
for (const [perm] of PERMS) {
  if (xml.includes(`android:name="${perm}"`)) continue;
  xml = xml.replace(/(\s*)<application/, `\n    <uses-permission android:name="${perm}" />$1<application`);
  console.log('[patch] + 权限', perm);
}

/** application 属性: 允许明文(连本机网关 http://127.0.0.1) */
if (!/android:usesCleartextTraffic=/.test(xml)) {
  xml = xml.replace(/<application/, '<application\n        android:usesCleartextTraffic="true"');
  console.log('[patch] + usesCleartextTraffic');
}

/** 旧版权限上限: WRITE_EXTERNAL_STORAGE 只在 API<=32 申请 */
if (!/android:maxSdkVersion/.test(xml) && xml.includes('WRITE_EXTERNAL_STORAGE')) {
  xml = xml.replace(
    /<uses-permission android:name="android\.permission\.WRITE_EXTERNAL_STORAGE" \/>/,
    '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"\n        android:maxSdkVersion="32" />'
  );
  console.log('[patch] ~ WRITE_EXTERNAL_STORAGE 限定 maxSdkVersion=32');
}

if (xml !== before) {
  fs.writeFileSync(MANIFEST, xml);
  console.log('[patch] 已写入 AndroidManifest.xml');
} else {
  console.log('[patch] AndroidManifest.xml 无需改动');
}

/** 应用名 */
if (fs.existsSync(STRINGS)) {
  let s = fs.readFileSync(STRINGS, 'utf8');
  const b = s;
  s = s.replace(/(<string name="app_name">)[^<]*(<\/string>)/, '$1Seedream$2')
       .replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, '$1Seedream$2');
  if (s !== b) { fs.writeFileSync(STRINGS, s); console.log('[patch] 应用名 -> Seedream'); }
}

console.log('[patch] 完成');
