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

/** ---------- build.gradle: 版本号 + 固定签名密钥 ---------- */
const GRADLE = path.join(ROOT, 'android/app/build.gradle');
if (fs.existsSync(GRADLE)) {
  let g = fs.readFileSync(GRADLE, 'utf8');
  const before2 = g;

  const ver = process.env.BUILD_VERSION || '0';
  const code = process.env.BUILD_CODE || ver.replace(/\D/g, '') || '1';

  // 版本号
  g = g.replace(/versionCode\s+\d+/, `versionCode ${code}`);
  g = g.replace(/versionName\s+"[^"]*"/, `versionName "1.0.${ver}"`);

  // 覆盖 debug 签名配置 -> 用仓库里固定的密钥(保证每次构建签名一致, 可覆盖安装)
  const ks = '../../signing/seedream.jks';
  const SNIP = `        seedream {
            storeFile file('${ks}')
            storePassword 'seedream'
            keyAlias 'seedream'
            keyPassword 'seedream'
        }
`;
  if (!g.includes('signingConfigs.seedream')) {
    if (/signingConfigs\s*\{/.test(g)) {
      g = g.replace(/signingConfigs\s*\{/, 'signingConfigs {\n' + SNIP);
    } else {
      // Capacitor 模板默认没有 signingConfigs 块 -> 插到 android { 之后
      g = g.replace(/android\s*\{/, 'android {\n    signingConfigs {\n' + SNIP + '    }\n');
    }
    console.log('[patch] + 签名配置 signingConfigs.seedream -> ' + ks);
  }

  // debug 构建类型指向我们的签名(Capacitor 模板里 buildTypes 只有 release, 需要自己加 debug)
  if (!/buildTypes\s*\{[\s\S]{0,600}?signingConfig signingConfigs\.seedream/.test(g)) {
    if (/buildTypes\s*\{[\s\S]*?debug\s*\{/.test(g)) {
      g = g.replace(/(buildTypes\s*\{[\s\S]*?debug\s*\{)/, '$1\n            signingConfig signingConfigs.seedream');
    } else {
      g = g.replace(/buildTypes\s*\{/, 'buildTypes {\n        debug {\n            signingConfig signingConfigs.seedream\n        }');
    }
    console.log('[patch] + debug 构建类型使用 seedream 签名');
  }

  // 打印签名相关片段, 便于从 CI 日志核对
  const m = g.match(/signingConfigs\s*\{[\s\S]*?\n    \}/);
  if (m) console.log('[patch] signingConfigs 片段:\n' + m[0]);
  g.split('\n').forEach(function (line) {
    if (/signingConfig|versionCode|versionName/.test(line)) console.log('[patch] gradle | ' + line.trim());
  });

  if (g !== before2) {
    fs.writeFileSync(GRADLE, g);
    console.log(`[patch] build.gradle 已更新 (versionCode=${code}, versionName=1.0.${ver})`);
  } else {
    console.log('[patch] build.gradle 无需改动');
  }
} else {
  console.warn('[patch] 未找到 android/app/build.gradle');
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
