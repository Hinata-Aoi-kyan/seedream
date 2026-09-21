# Seedream Web

**多模型 AI 生图工具** —— 支持参考图生图、提示词优化、局部编辑（涂抹 / 框选改一块）、生成记录。

两种形态，同一套界面：

| | **Android App（推荐）** | **网页版（Termux 网关）** |
|---|---|---|
| 安装 | 直接装 APK | Termux 里跑 Python 网关 |
| 网络 | **不监听任何端口**，请求走原生层直连云端 API | 浏览器 → 本机 `localhost:8765` |
| 说明 | 完全自包含，不需要 Termux | 需要一个本地进程常驻 |

---

## 📱 Android App

### 下载

**https://github.com/Hinata-Aoi-kyan/seedream/releases/latest**

下载 `app-debug.apk`（约 4 MB）→ 安装（需允许「安装未知来源应用」）。

> 使用 **debug 签名**，个人使用没问题；Google Play 保护机制可能提示，选择「仍要安装」。

### 使用

1. 打开 App → 底部 **设置** → 点「新增提供方」或编辑已有项
2. 填 **Base URL** 和 **API Key**（Key 默认显示为黑点，点右侧眼睛看原文）
3. 点 **检测模型** → 在结果里点 `+生图` / `+文本` 直接加入
4. 回「生成」页 → 输入提示词 → **生成图片**

生成完成后会**弹出系统通知**，图片自动保存到**手机相册**。

### 自己构建

推送代码后由 **GitHub Actions 自动构建**（见 `.github/workflows/android.yml`）。
构建产物发布到 Release，也可以从 Actions 运行页下载 Artifact。

细节（含踩过的坑）见 **[APK.md](APK.md)**。

---

## 💻 网页版（Termux）

适合想在电脑/手机浏览器里用、或想改代码的人。**需要一个本地网关**，原因见下方「为什么需要网关」。

```bash
# 1) 装依赖（Termux 从 F-Droid 装，别用 Play 版）
pkg update && pkg install python termux-api -y
termux-setup-storage          # 授权相册

# 2) 启动
cd ~/seedream-web
bash manage.sh start          # 状态: status / 停止: stop / 重启: restart
# 浏览器打开 http://localhost:8765
```

可选：`pip install pillow`（不装也能用，只影响参考图压缩）

### 为什么需要网关

BytePlus / OpenAI 的生图接口**不放行浏览器跨域请求**（CORS 预检不允许 `Authorization` 头），纯网页直连必失败。
所以由手机上的小网关代发请求 —— 服务端到云端没有跨域问题，网页只访问本机同源地址。

> **APK 版不需要网关**：它用 Capacitor 的原生 HTTP（`CapacitorHttp`）发请求，原生层不受 CORS 限制。

---

## ✨ 功能

| | 说明 |
|---|---|
| **多服务方** | BytePlus / 火山方舟、任何 OpenAI 兼容中转，可自由增删改 |
| **参考图生图** | 最多 10 张，可拖拽排序、逐张指定作用（主体 / 姿势 / 构图）；自动去重 |
| **提示词优化** | 一段式 / 两段式；可用视觉模型读参考图；**默认关闭推理模型的思考模式**（大幅提速） |
| **局部编辑** | 画笔涂抹或框选，只改选中区域。**GPT 走 mask 精确重绘，Seedream 走归一化坐标**；支持全选整图、连续编辑 |
| **生成记录** | 批量选择 / 保存 / 删除；显示实际尺寸、文件大小、全部参数 |
| **主题** | 顶栏按钮三态循环：深色 → 浅色 → 跟随系统（防首屏闪烁） |
| **通知与相册** | App 走原生通知 + 原生保存；网页版走浏览器通知 + 下载 |
| **零 Emoji** | 全站 30 个手写 SVG 图标 |

---

## 🗂 目录结构

```
seedream-web/
├── gateway.py             # 网页版网关（纯标准库，无第三方依赖）
├── index.html             # 前端界面（单文件）
├── static/native-api.js   # APK 版后端（JS 实现，走原生 HTTP）
├── providers.default.json # 默认配置（随包分发）
├── providers.json         # 用户配置（gitignore，更新不覆盖）
├── manage.sh / start.sh   # 启停脚本
├── scripts/               # APK 构建辅助脚本
├── .github/workflows/     # APK 云构建
└── APK.md                 # 打包说明
```

---

## 🔐 安全

- **API Key 只存在本地**：网页版存手机 `keys.json`，App 存应用私有目录
- 网页版网关默认绑 `0.0.0.0`，**同一 WiFi 下其他设备可访问**。只在本机用的话建议：
  ```bash
  HOST=127.0.0.1 bash manage.sh start
  ```
- 明文 Key 接口 `/api/key` **仅允许本机访问**，局域网来源返回 403
- App 版**不开任何监听端口**，同一台手机上的其他 App 也连不上

---

## ⚙️ 环境变量（网页版）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8765 | 端口 |
| `HOST` | 0.0.0.0 | 监听地址（设 `127.0.0.1` 可只允许本机） |
| `MEDIA_DIR` | 自动 | 图片保存目录 |
| `DB_PATH` | ./history.db | 历史数据库 |
| `NET_RETRIES` | 2 | 传输层瞬时错误重试次数 |
| `DISABLE_THINKING` | 1 | 置 0 则不注入 `thinking=disabled` |
| `ARK_API_KEY` / `OPENAI_API_KEY` | 空 | 也可用环境变量代替 keys.json |

---

## 📄 License

个人项目，随意使用。
