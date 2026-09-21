# 打包 Android APK

沙箱里没有 JDK / Android SDK，**APK 由 GitHub Actions 云端构建**。

## 拿到 APK

**https://github.com/Hinata-Aoi-kyan/seedream/releases/latest**

每次推送代码会自动构建并发布一个带版本号的 Release（`v1.0.<构建号>`），
文件名形如 `Seedream-1.0.10.apk`。

> **为什么用带版本号的标签**：`apk-latest` 这种固定 URL 会被 CDN 缓存，可能出现"下载了还是旧包"。
> 每次 URL 唯一就没这个问题。`releases/latest` 页面始终指向最新一版。

### 安装 / 更新
- **签名固定**：仓库里的 `signing/seedream.jks` 是固定的签名密钥，所有构建共用同一个签名
  → 装过之后可以**直接覆盖安装**，不用卸载、不丢设置
- 从旧版本（v1.0.9 及更早）升级：那些版本用的是一次性 debug 密钥，
  **需要最后卸载重装一次**，之后就正常了
- 装好后在 **设置页最底部** 能看到构建标记（`构建 v1.0.10 · 033915d · 时间`），
  用来确认装的到底是哪一版

### 关于签名密钥
`signing/seedream.jks` 提交在仓库里（口令 `seedream`），这样 CI 每次能用同一个签名。
这是个**个人使用**的密钥；如果你要正式分发，建议换成你自己的密钥并改用 GitHub Secrets 存放。

## 构建状态怎么看

- **成功**：自动发 Release（上面的链接）
- **失败**：工作流把日志写回仓库 `.ci/status.json`，用 GitHub API 就能读

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
