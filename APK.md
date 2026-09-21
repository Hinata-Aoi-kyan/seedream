# 打包 Android APK

沙箱里没有 JDK / Android SDK，**APK 由 GitHub Actions 云端构建**（工作流见 `.github/workflows/android.yml`）。

## 怎么出包

1. 把代码推到 `main`（改动 `index.html` / `package.json` / `scripts/**` 等会自动触发构建）
2. 打开仓库 **Actions** 标签 → **Build Android APK** → 等 3~8 分钟
3. 构建完成后在该次运行页面底部 **Artifacts** 下载 `seedream-apk`
4. 解压得到 `app-debug.apk`，传到手机安装（需在系统里允许「安装未知来源应用」）

也可以手动触发：Actions → Build Android APK → **Run workflow**。

## 工程结构

```
package.json            # Capacitor 依赖(CI 里用 @latest 安装)
capacitor.config.json   # appId / webDir=www / CapacitorHttp 开启
scripts/prepare-www.mjs # 把 index.html、static/ 等收集到 www/ (单一来源)
scripts/patch-android.mjs # 给生成的 Android 工程打补丁(权限/明文/应用名)
.github/workflows/android.yml # 云构建
```

`www/`、`android/`、`node_modules/` 都是**构建产物，不入库**。

## 已经处理的「坑」

| 坑 | 处理 |
|---|---|
| 通知 | `sysNotify()`：APK 走 **LocalNotifications**，网页走 Notification API（`requestNotif()` 同步适配） |
| 存相册 | `saveImageFile()`：APK 走原生（优先自定义 `MediaStore` 插件，退回 Filesystem/文档目录），网页走 `<a download>` |
| 权限 | 构建时自动补 `INTERNET` / `POST_NOTIFICATIONS` / `READ_MEDIA_IMAGES` / `WRITE_EXTERNAL_STORAGE(maxSdk=32)` |
| 明文 HTTP | 打开 `usesCleartextTraffic`（连本机 `http://127.0.0.1:8765` 需要） |
| 组件导出 | 保留 Capacitor 默认的 `MainActivity exported=true`（启动入口必须导出），其余组件不导出 |
| CORS | 开启 **CapacitorHttp** —— 请求走原生层，**不受 CORS 限制** |
| 应用名 | 打包时改成 `Seedream` |

## 重要：局域网问题

- APK 里 WebView 加载的是**应用内页面**，不再对局域网开放 ✅
- 但如果 API 仍然请求 Termux 里的网关（`127.0.0.1:8765`），**那个网关还是绑着 `0.0.0.0`** → 局域网风险仍在
- 彻底解决有两条路（见下）

## 后续路线

**路线 A（当前）**：APK 作为客户端，仍连 Termux 网关
- 优点：零改动，先跑通打包流程
- 缺点：仍需开着 Termux；局域网问题取决于网关的 HOST 设置

**路线 B（彻底自包含）**：把网关逻辑搬进 APK
- 让 WebView 里的 JS 直接用 **CapacitorHttp** 调云端接口（原生层无 CORS），不再需要本地网关
- 历史记录换 IndexedDB / Filesystem；通知、存图已用原生
- 结果：**没有监听端口**，任何设备/任何 App 都连不上 → 彻底无局域网问题
- 代价：需要把 `gateway.py` 的业务逻辑移植成 JS（约 400 行）

## 本地想自己构建

需要 JDK 17+ 和 Android SDK：

```bash
npm install @capacitor/core@latest @capacitor/cli@latest @capacitor/android@latest \
            @capacitor/filesystem@latest @capacitor/local-notifications@latest @capacitor/app@latest
node scripts/prepare-www.mjs
npx cap add android
node scripts/patch-android.mjs
npx cap sync android
cd android && ./gradlew assembleDebug
# 产物: android/app/build/outputs/apk/debug/app-debug.apk
```

## 首次启用（重要）

GitHub Actions 的工作流文件必须放在 `.github/workflows/` 下，而**当前的 PAT 没有 `Workflows` 写入权限**，推不上去。
所以工作流源文件放在 `ci/android-workflow.yml`，用下面**任一方式**启用：

**方式一（推荐，一次性授权）**
GitHub → Settings → Developer settings → Fine-grained tokens → 编辑该 token →
`Repository permissions` → 找到 **Workflows** → 设为 **Read and write** → 保存。
之后我就能直接把工作流推到 `.github/workflows/`。

**方式二（网页手动创建）**
仓库 → 打开 `ci/android-workflow.yml` → 复制全文 →
Add file → Create new file → 文件名填 `.github/workflows/android.yml` → 粘贴 → Commit。
