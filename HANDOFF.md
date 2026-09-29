# 交接文档 · Seedream Web

> 交接时间：2026-09-27
> 用途：把项目转到 PC 做最后优化

---

## 0. 项目地址

```
https://github.com/Hinata-Aoi-kyan/seedream
```

**已公开（public）**，PC 上直接克隆即可：

```bash
git clone https://github.com/Hinata-Aoi-kyan/seedream.git
cd seedream
```

**APK 下载**（始终最新）：
```
https://github.com/Hinata-Aoi-kyan/seedream/releases/latest
```
产物名形如 `Seedream-1.1.<构建号>.apk`（versionCode=10000+构建号，高于本地调试段 9000，可覆盖安装），约 5 MB，debug 签名（固定密钥，可覆盖安装）。

---

## 1. 项目是什么

多模型 AI 生图工具：参考图生图、提示词优化、**局部编辑**（涂抹/框选改一块）、生成记录。
支持 **BytePlus Seedream** 和任意 **OpenAI 兼容中转**。

**两种形态，共用同一套前端（index.html）**：

| | **APK（主推）** | **网页版** |
|---|---|---|
| 后端 | `static/native-api.js`（JS 实现，跑在 App 内） | `gateway.py`（Python 标准库 HTTP 服务） |
| 网络 | CapacitorHttp 原生请求直连云端 API，**无监听端口** | 浏览器 → 本机 `localhost:8765` |
| 数据 | localStorage + 应用文档目录 | SQLite + `prefs.json` + 浏览器 localStorage |
| 需要 | 装 APK 即可 | 需要 Termux 常驻 |

### 为什么需要两种后端

云端 API **不放行浏览器跨域**（CORS 预检不允许 `Authorization` 头），所以：
- 网页版：靠本地网关**代发请求**（服务端到云端无跨域）
- APK：靠 **CapacitorHttp**（原生层发请求，不受 CORS 限制）→ 彻底不需要服务器

---

## 2. 目录结构

```
seedream-web/
├── index.html              前端单文件（2180 行）—— 两套形态共用
├── gateway.py              网页版网关（1473 行，纯标准库，无第三方依赖）
├── static/
│   ├── native-api.js       APK 后端（678 行）—— 用 CapacitorHttp/FS/Notifications 实现原网关全部接口
│   ├── Sortable.min.js     参考图拖拽排序
│   └── icon-192/512.png
├── providers.default.json  默认提供方（随包分发；首次运行会播种）
├── providers.json          用户配置（gitignore）
├── scripts/
│   ├── prepare-www.mjs     收集网页文件到 www/ + 注入构建标记
│   └── patch-android.mjs   给 cap 生成的 Android 工程打补丁（权限/签名/版本号/应用名）
├── tools/                  PC 侧排查/验收工具（不进 APK）
│   ├── mock_api.py         报文窃听/仿 ark mock（/waf 复刻风控 403；见 4.1）
│   ├── cdp.mjs             adb + CDP 在 App WebView 里执行 JS（免 UI 自动化；CDP_PORT 可换端口）
│   ├── probe-*.js          现成探针：诊断直连 / 风控回退 / 注入假历史 / 图片预览链路(真实文件端到端)
│   ├── shot.sh             模拟器截图到 ui/ 目录
│   ├── dev-loop.sh         一键热重载: prepare-www → cap sync → gradle → 安装 → 启动
│   └── check-static.js     静态检查: 模板误用拼接 + CSS 同规则重复属性
├── .github/workflows/android.yml   云构建 APK
├── signing/seedream.jks    固定签名密钥（口令 seedream，PKCS12）
├── capacitor.config.json   appId / webDir=www / CapacitorHttp 开启
├── package.json
├── manage.sh / start.sh    Termux 启停脚本
├── APK.md / README.md
└── HANDOFF.md              本文件
```

---

## 3. 怎么跑

### 3.1 网页版（Termux 或 PC）

```bash
# Termux
cd ~/seedream-web && bash manage.sh start     # 浏览器开 http://localhost:8765
# PC（任何有 python3 的环境都行）
python3 gateway.py                             # 同样 http://localhost:8765
```

环境变量：`PORT`(8765) `HOST`(0.0.0.0) `MEDIA_DIR` `DB_PATH` `NET_RETRIES`(2) `DISABLE_THINKING`(1)

> ⚠️ `HOST` 默认 `0.0.0.0`，**局域网内其他设备可访问**。只在本机用请设 `HOST=127.0.0.1`。
> 明文 Key 接口 `/api/key` 只允许 loopback（局域网来源 403）。

### 3.2 构建 APK

**云端（推荐，无需本地环境）**：推代码到 main 自动触发
```
.github/workflows/android.yml
```
> 关键坑见第 5 节，改工作流前先看。

**本地构建**（需要 JDK 17+ 和 Android SDK）：
```bash
npm install @capacitor/core@latest @capacitor/cli@latest @capacitor/android@latest \
            @capacitor/filesystem@latest @capacitor/local-notifications@latest \
            @capacitor/app@latest @capacitor-community/media@latest \
            @capacitor/status-bar@latest @capacitor/browser@latest
node scripts/prepare-www.mjs
npx cap add android
node scripts/patch-android.mjs
npx cap sync android
cd android && ./gradlew assembleDebug
# 产物: android/app/build/outputs/apk/debug/app-debug.apk
```
> `patch-android.mjs` 会自动补权限、`usesCleartextTraffic`、应用名、版本号，并把签名指向 `signing/seedream.jks`。
> 首次构建若 `signing/seedream.jks` 不存在，工作流会自动生成并提交（务必保留，否则签名变化会导致无法覆盖安装）。

---

## 4. ⚠️ 未解决的问题（重点）

### 4.1 【已解决 ✅ 2026-09-27】APK 里提示词优化报 403

**结论与修复**（PC 上用模拟器 + 报文窃听服务器实锤，详见下方「排查过程」）：

- **根因**：CapacitorHttp 走 Android `HttpURLConnection`，默认 `User-Agent: Dalvik/2.1.0` 且无 `Accept`。
  用户手机经 FlClash 的出口 IP 被平台风控标记后，该「Dalvik 指纹」的 **POST** 被 403 拦截（GET 列模型放行）。
  干净 IP 下同样报文只回 401/200 —— 所以本机 curl 一切正常，唯独手机上的 App 中招。
- **修复**（`static/native-api.js`，两层）：
  1. `clientHeaders()`：原生请求统一补 WebView 版 `User-Agent`（经 `x-cap-user-agent` 通道）+ `Accept: */*`；
  2. **403 自动回退**：原生通道拿到 403 时，用隐藏 iframe 里**未被补丁的浏览器 fetch**（Chromium 协议栈，
     与原生完全不同的 TLS/报文指纹）自动重试一次；ark 已实测支持 CORS（回显 Origin + 放行
     `authorization,content-type`），所以这条路能通。其它不放行 CORS 的中转会自动维持原生结果，无回归。
- **注意**：`CapacitorHttp.enabled:true` 时 `window.fetch` 被补丁接管（仍走原生栈）——
  这就是为什么要从 iframe 里取 fetch。**不要**为解决这个问题直接把 `enabled` 改 false
  （`importFromGateway` 跨域读 `127.0.0.1:8765` 等现有功能依赖补丁 fetch 免 CORS）。
- **真机验证**：装新包 → 设置页「诊断」→ 看 ② 的「传输」行：`native`=直连恢复；
  `fetch(原生403回退)`=原生被拦但已自动治愈。若仍 403 → 是 FlClash 分应用分流把 App 走到了被风控的出口，
  把本 App 与 curl/RikkaHub 设为同一节点（或关代理直试）。

**排查工具（可复用，在 `tools/`）**：
- `mock_api.py` —— 窃听服务器：模仿 ark 返回 + 原样记录每个请求的报文头/体到 `mock-log.jsonl`；
  `/waf` 前缀复刻真机症状（POST 且无 Origin → 403）。
- `cdp.mjs` —— 经 adb forward + WebView 远程调试在 App 里执行任意 JS（如直接调
  `NATIVE_API.handle('POST','/api/test',{base_url, api_key, model})`，无需 UI 操作）。
- `probe-testconn.js` / `probe-waf.js` —— 两条现成探针。模拟器里宿主机地址是 `http://10.0.2.2:<端口>`。

<details><summary>原始现象记录（存档）</summary>

| 环境 | 结果 |
|---|---|
| `curl`（同 Key / 同模型 / 同 Base URL） | ✅ 正常返回 |
| RikkaHub（同 Key / 同配置） | ✅ 正常回复 |
| **本 App（旧版）** | ❌ `HTTP 403 · you do not have access to the requested resource` |

旧版诊断输出：`① 列模型 HTTP 200 · 58 个 ✅` / `② 对话模型 HTTP 403`。
修复前抓包证实：App 的 POST 带 `User-Agent: Dalvik/2.1.0 (Linux; U; Android 15; ...)`、无 `Accept`。

</details>

### 4.2 待真机验证的功能（逻辑已测，实机未确认）

- [ ] **原生 multipart 上传** —— GPT 参考图编辑走 `/images/edits` + `FormData`，
      `CapacitorHttp` 对 FormData 的处理需实测（`genOpenai` / `doEdit`）
- [ ] **写入相册** —— `@capacitor-community/media` 的 `savePhoto`（`saveOutputs`）
      失败会退回应用文档目录，功能不中断但进不了相册
- [ ] **系统通知** —— `@capacitor/local-notifications`（`sysNotify`）
- [ ] **状态栏安全区** —— 已改用 Capacitor 8.3+ 注入的 `--safe-area-inset-*`
      （Android WebView <140 的 `env()` 有 bug 会返回 0），设置页底部可看到实际读到的数值

### 4.3 其它

- **仓库可见性**：已公开。若要转私有，注意 `signing/seedream.jks` 是**个人使用**的密钥，
  正式分发建议换成自己的密钥并改用 GitHub Secrets 存放
- **PAT 失效**：交接时用的 GitHub PAT 已 `Bad credentials`，需要换新的
  （CI 用的是 `GITHUB_TOKEN`，不受影响；只有外部脚本调用 API 才用到 PAT）

---

## 5. 已解决的重要坑（避免重踩）

### 5.1 Capacitor 相关

| 坑 | 原因 & 修法 |
|---|---|
| **所有请求失败，报 `Unexpected token '<', "<!DOCTYPE"...`** | Capacitor 桥接脚本**注入时机晚于页面脚本** → 模块加载时 `window.Capacitor` 是 `undefined` → 本地实现被判为不可用 → 请求打到 Capacitor 本地服务器返回 index.html。<br>**修法：绝不加载时取 `window.Capacitor`，全部函数内惰性获取；`init()` 里 `await waitForBridge(2000)`** |
| **`jget` 绕过本地实现** | `jget` 曾是裸 `fetch`，没走 `jreq` → 所有 GET 请求失败。<br>**修法：`jget` 也走 `jreq`** |
| **Android 15 顶栏被状态栏遮挡** | edge-to-edge 强制；`env(safe-area-inset-*)` 在 WebView<140 返回 0。<br>**修法：读 Capacitor 8.3+ 注入的 `--safe-area-inset-*`（`syncInsets()`）** |
| **CSS 安全区不生效** | `padding-top:calc(...)` 被后面的 `padding:12px 16px` **简写覆盖**（×3 处）。<br>**修法：合并成单条声明放最后** |

### 5.2 云构建（GitHub Actions）

| 坑 | 修法 |
|---|---|
| `android-actions/setup-android@v3` 失败 | 它内部执行 `sdkmanager "tools"`，而该包已从 SDK 仓库移除。**runner 镜像本就预装 Android SDK，不要用这个 action** |
| `The Capacitor CLI requires NodeJS >=22` | 工作流 Node 20 → **22** |
| 推 `.github/workflows/` 被拒 | PAT 必须有 **Workflows** 权限 |
| 无法覆盖安装 | runner 临时 debug 密钥每次都不同。**修法：首次构建生成 `signing/seedream.jks` 并提交，之后复用；构建完再用 `apksigner` 显式重签**（Capacitor 模板的 `build.gradle` 既没有 `signingConfigs` 也没有 `debug` 构建块，改 gradle 太脆弱） |
| 下载到的还是旧包 | 固定 URL 被 CDN 缓存。**修法：Release 用版本化标签 `v1.0.<构建号>`** |
| PC 本地构建 gradle 下载超时 | services.gradle.org 被墙/慢。改 `android/gradle/wrapper/gradle-wrapper.properties` 的域名为 `mirrors.cloud.tencent.com/gradle`（android/ 是生成物，每次 `cap add` 后要重改；sed 匹配域名部分即可，别带 `\:` 转义） |
| PC 上 adb/本地服务端口莫名占用 | **Hyper-V 保留端口段**（`netsh interface ipv4 show excludedportrange protocol=tcp`）会吞掉如 8642/9222 等端口，报 WinError 10013。换个不在段里的端口即可（本机验证用 8642→mock、9411→CDP） |

### 5.3 前端

| 坑 | 说明 |
|---|---|
| **反引号模板里写了 `'+icon('x')+'`** | 会渲染成字面文本。模板里必须用 `${icon('x')}`，单引号拼接才用 `'+icon('x')+'`。**校验：用状态机扫 code/sq/dq/tpl 四态** |
| **`textContent=` 清空图标** | 按钮里的 SVG 会被一起清掉（共 6 处）。**改用 `innerHTML`** |
| 优化提示词默认值永远是 GPT 版 | `optDefaultForCurrent()` 曾硬编码返回 GPT 版 |
| 旧提示词读不回来 | **读写用了两套不同的 localStorage key**（写 `sw_optprompt_<provider>`，读 `sw_optprompt_gpt`）。已统一为 `loadOptPrompt()` |
| **小注/诊断行里的图标渲染成巨大黑块** | `icon()` 的 SVG 没有 width/height，依赖父级 CSS 定尺寸；`.small-note`、`_chkRow` 等文本场景没有 svg 规则 → SVG 塌成默认 300×150。**修法：全局兜底规则 `svg[viewBox="0 0 24 24"]{width:16px;...}`，组件规则(选择器更具体/更靠后)照样覆盖** |
| **预览图片黑底裂图(生成结果/记录), 保存到相册却正常** | `native-api.js` 的 `fileBase()` 用了**未定义的裸 `FS`**（应为 `PL('Filesystem')`）→ ReferenceError 被吞 → `FILE_BASE` 为空 → `imgSrcOf()` 返回空串 → `<img src="">` 裂图。叠加两个放大器：①失败结果还被缓存进 localStorage（空串），`!=null` 短路导致永远不再重试；②`saveImageFile` 走 `fetch('/img/…')` 而 sw.js 是纯透传、APK 里没有该路由 → 404 空文件。**修法：`fileBase()` 懒取插件 + 只缓存 `file:` 开头的值 + 失败不缓存；`saveImageFile` 对 `/img/` 直接 `FS.readFile`**。验证：`tools/probe-preview-e2e.js` 用真实文件跑通「写盘→imgSrcOf→记录网格→结果区→保存」全链路（data:URL 假图**测不到**这条路径，之前漏掉就是因为用的假图）|
| 保存 Key "没反应" | `saveProvider` 有 DOM 取值在 `try` 外且按钮无 `.catch` → 异常被静默吞掉。**已改为整体 try/catch + 按钮加 catch + 一定给反馈** |
| 设置页视图切换"反复抽拉" | 用了两次动画（旧滑出+新滑入）。**改单元素滑动 + 过渡期锁容器高度** |

---

## 6. 测试方法（可复用的自测）

项目里没有单元测试框架，但有一批**用 Node 桩环境跑真实函数**的脚本（在 `/tmp`，需重建）：

思路（建议 PC 上重做，很容易）：
1. 用最小 DOM 桩 + Capacitor 桩
2. **从 `index.html` 里抽取真实函数**（用花括号配对，注意 `async` 前缀）来跑，
   而**不是**只测 `native-api.js` —— 之前就是因为只测后者，漏掉了 `jget` 绕过 `jreq` 的 bug
3. 关键断言：
   - `jget`/`jpost`/`jput` 全部走本地实现（断言"**未发出任何 `/api` 网络请求**"）
   - 保存 Key 后能读回、检测模型能取到 Key
   - CSS：扫描规则确认 `padding`/`height` **每种属性只出现一次**（防覆盖）
   - 模板字符串：状态机确认没有在反引号里误用拼接语法

---

## 7. 关键设计说明（改代码前先看）

### 7.1 前端如何区分两种形态

```js
const GW_IS_NATIVE = isNative();          // init 里 await waitForBridge(2000) 之后确定
async function jreq(m, u, b, timeout){
  if(window.NATIVE_API && window.NATIVE_API.handle){
    const r = await window.NATIVE_API.handle(m, u, b);
    if(r !== undefined) return r;         // 本地实现接管
  }
  u = gwUrl(u);                           // 否则走网关(网页版同源, GW_BASE 为空)
  ...
}
```
**`NATIVE_API.handle` 未处理的路径返回 `undefined`**，网页版据此回退到网络请求。

### 7.2 局部编辑的实现差异

| 服务方 | 机制 |
|---|---|
| **GPT** | `/images/edits` + `mask`（PNG，**透明区=要重绘**） |
| **Seedream** | prompt 里注入归一化坐标 `Image 1 x1 y1 x2 y2`（**0-999**，左上原点）。全选时改用 "Apply this change to the entire image" |

- 图片 >2048px 自动降采样（保证图与 mask 同尺寸）
- Seedream 编辑**不接受 `size=auto`**（那是 `layer_decomposition` 专用）→ 自动改 `2K`

### 7.3 任务模型

前端对 `/api/generate`、`/api/edit` 的预期是**异步任务**：
- 提交后立刻拿到 `{task_id}`，之后轮询 `/api/task/<id>` 直到 `_status` 为 `done`/`failed`
- 网页版：Python 线程池
- APK：`startJob()` 内存任务表（行为一致，前端无需区分）

### 7.4 图标

全站**零 Emoji**，30 个手写 SVG 在 `ICONS` 对象里，用 `icon('名字')` 取。
静态 HTML 里的按钮用 `data-icon="名字"` 占位，`init()` 时 `fillDataIcons()` 统一填充。

---

## 8. 建议的接手顺序

1. **先在 PC 上跑网页版**：`python3 gateway.py` → 打开 `localhost:8765`
   用你手机上那份 `providers.json` / `keys.json`（从手机拷过来）验证功能正常
2. **复现并解决 4.1 的 403**（最高优先级，也是唯一阻塞 APK 可用性的问题）
3. **按 4.2 清单在真机验证**那四项原生能力（需要装 APK 实测）
4. 可选：补上签名/正式发布流程，换掉个人密钥

---

## 9. 联系上下文

- 用户手机用 **FlClash VPN**、Termux 里跑网页版
- Termux **未装 pillow** → 网关里凡是读图片尺寸/alpha 的地方都必须是**纯 Python 实现**（不要引入 PIL 依赖）
- 沙箱/CI 的坑：命令结束后后台进程会被回收（跨命令的服务测试要在同一条命令里跑完）
