# 打包 Android APK

沙箱里没有 JDK / Android SDK，**APK 由 GitHub Actions 云端构建**。

## 拿到 APK

**每推一次代码自动构建**，成功后发布到 Release（固定链接，始终是最新版）：

```
https://github.com/Hinata-Aoi-kyan/seedream/releases/download/apk-latest/app-debug.apk
```

或：仓库 → **Releases** → `apk-latest` → 下载 `app-debug.apk`（约 4.2 MB）
也可以从 Actions 运行页面的 **Artifacts** 下载。

### 安装
1. 手机浏览器打开上面的链接下载
2. 系统设置里允许「安装未知来源应用」（针对浏览器/文件管理器）
3. 点开 apk 安装。这是 **debug 签名**，个人用没问题；Play Protect 可能提示，选「仍要安装」

## 首次使用

APK 打开后 → 底部 **设置** → 顶部 **网关地址**（默认 `http://127.0.0.1:8765`）：

1. 先在 Termux 里确保网关已启动：`cd ~/seedream-web && bash manage.sh start`
2. 回到 APK 点 **测试连接** —— 显示「连接成功 · 服务器时间 xx:xx:xx」即可用
3. 如果连不上：确认网关在跑、端口是 8765、网关地址没写错

> 之后路线 B 做完就不需要 Termux 了。

## 构建状态怎么看

- **成功**：自动发 Release（上面的链接）
- **失败**：工作流把日志写回仓库 `.ci/status.json`，用 GitHub API 就能读（当前 PAT 无 Actions 权限也能看）

## 已处理的「坑」

| 坑 | 处理 |
|---|---|
| 通知 | `sysNotify()`：APK 走 **LocalNotifications**，网页走 Notification API |
| 存相册 | `saveImageFile()`：APK 走原生（优先 `MediaStore` 插件 → 退回 Filesystem），网页走 `<a download>` |
| 权限 | 构建时自动补 `INTERNET` / `POST_NOTIFICATIONS` / `READ_MEDIA_IMAGES` / `WRITE_EXTERNAL_STORAGE(maxSdk=32)` |
| 明文 HTTP | 打开 `usesCleartextTraffic`（连本机 `http://127.0.0.1:8765` 需要） |
| CORS | 开启 **CapacitorHttp** —— 请求走原生层，不受 CORS 限制 |
| 应用名 | 打包时改成 `Seedream` |
| 局域网 | APK 的 WebView 加载应用内文件，**不再对外开端口** ✅ |

## 踩过的构建坑（留给以后）

1. **`android-actions/setup-android@v3` 会失败** —— 它内部执行 `sdkmanager "tools"`，而 `tools` 包已从 SDK 仓库移除。
   → runner 镜像本来就预装 Android SDK（`ANDROID_HOME=/usr/local/lib/android/sdk`），**不要用这个 action**
2. **Capacitor 8 的 CLI 要求 Node ≥ 22** —— 用 Node 20 会报 `The Capacitor CLI requires NodeJS >=22.0.0`
3. **PAT 必须有 `Workflows` 权限**才能推 `.github/workflows/` 下的文件

## 后续路线

**路线 B（彻底自包含）**：让 WebView 里的 JS 直接用 **CapacitorHttp** 调云端接口，不再需要本地网关
- 历史记录换 IndexedDB / Filesystem；通知、存图已用原生
- 结果：**没有监听端口**，任何设备/任何 App 都连不上 → 彻底无局域网问题，也不需要 Termux
- 代价：把 `gateway.py` 的业务逻辑移植成 JS（约 400 行）

## 本地想自己构建

```bash
npm install @capacitor/core@latest @capacitor/cli@latest @capacitor/android@latest \
            @capacitor/filesystem@latest @capacitor/local-notifications@latest @capacitor/app@latest
node scripts/prepare-www.mjs
npx cap add android
node scripts/patch-android.mjs
npx cap sync android
cd android && ./gradlew assembleDebug
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
