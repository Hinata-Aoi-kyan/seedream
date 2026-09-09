# Seedream Web · 手机本地生图网关

一个跑在 **手机 Termux**（或任何 Python 环境）里的本地网关 + 网页界面。
浏览器打开 `localhost:8765` 即可：多参考图生图、接入多个 API / 不同模型、提示词优化、生成记录、结果自动存相册。

## 为什么要有这个网关
- AI 接口（尤其 BytePlus 生图）**不允许浏览器直接跨域调用**（CORS 预检不放开 `Authorization` 头），纯网页直连会报跨域错。
- 因此由**手机上的网关**来发起请求（服务端到云端，无跨域），网页只访问本机 `localhost`（同源，无 CORS）。
- **API Key 只存手机本机 `keys.json`**，既不暴露给前端页面，也不外泄。

## 目录结构
```
seedream-web/
├── gateway.py             # 本地网关(纯标准库 HTTP 服务)，多 provider 转发、存图、历史库、系统通知
├── index.html             # 前端界面(单文件)
├── providers.default.json # 默认配置(随仓库分发)
├── providers.json         # 用户配置(gitignore，更新不覆盖)
├── manage.sh / start.sh   # 启动/停止/重启/状态
├── manifest.json / sw.js  # PWA
├── static/                # 静态资源(图标、Sortable.min.js)
└── README.md
```
> 敏感文件不入库：`providers.json`、`keys.json`、`prefs.json`、`history.db`、`media/`、`server.log`。

## 手机 (Termux) 运行步骤
```bash
# 1) 安装 Termux(F-Droid 版, 勿用 Play 版) 后:
pkg update && pkg install python termux-api -y
termux-setup-storage        # 授权访问相册(必须, 结果图才进相册)
pip install -U pip
pip install pillow          # 可选: 用于参考图压缩与尺寸读取

# 2) 把 seedream-web 文件夹拷到手机(如 ~/seedream-web)，进入目录
cd ~/seedream-web

# 3) 启动网关(后台常驻)
bash manage.sh start        # 状态: bash manage.sh status  停止: bash manage.sh stop
# 浏览器打开 http://localhost:8765
```

## 首次使用
1. 点右上角 **设置**，填入各 provider 的 API Key（BytePlus 用 `ARK_API_KEY`，OpenAI 中转用对应 Key）。
2. 回主页输入提示词，可点 **优化提示词**（用文本模型扩写；有参考图时可用视觉模型）。
3. **参考图**：最多 10 张，可拖拽排序、逐张指定作用（主体/姿势/构图等），本地图自动转 base64，也可粘贴 URL。
4. 选生图模型与尺寸 → **生成图片**。任务在后台跑，可以离开页面；完成/失败会弹**手机系统通知**（点击可跳回记录页）。
5. 结果自动保存到手机相册 `Pictures/seedream-web/`，并出现在 **生成记录**，可回看/保存/批量删除。

## 支持的模型(在设置页或 providers.json 里改)
- **BytePlus / 火山方舟**（`/images/generations`，支持多参考图）
  - 生图：`dola-seedream-5-0-pro-260628`（Seedream 5.0 Pro）、`seedream-5-0`（Lite）
  - 尺寸：只接受 `1K / 1.5K / 2K / auto` 或 `宽x高` 像素；比例值会自动映射为合法像素
  - 内置优化档位：`standard` / `fast`（`optimize_prompt_options.mode`）
  - 文本：`dola-seed-2-1-turbo`（视觉）、`deepseek-v4-flash`、`deepseek-v3-0324`
- **OpenAI 兼容中转**（文生图 `/images/generations`，图生图 `/images/edits`）
  - 生图：`gpt-image-2`、`gpt-image-2-4k`、`gpt-image-2.5-sunburst`、`gpt-image-2.5-flare`
    - **2.5 两兄弟的区别**（OpenAI 官方）：`sunburst` = 基座模型，**质量为重**，画质高于 gpt-image-2；
      `flare` = 小模型，**速度为重**，画质与 gpt-image-2 相当。要质量选 sunburst，要快选 flare。
    - 2.5 系列额外支持 `xhigh` / `max` 质量档
    - 尺寸约束：单边 ≤3840、双边为 **16 的倍数**、长边/短边 ≤3:1、总像素 655,360~8,294,400（>2560×1440 属实验性）
    - **透明背景**：需配合 `png`/`webp`（选 jpeg 会自动改 png）。若该模型/中转不支持，网关会
      **自动回退为不透明**并在结果区提示，不会直接失败。
  - 文本：`gpt-4o`

## 提示词优化：关闭思考模式（默认开）
推理类文本模型（DeepSeek V4、Seed 2.1 Turbo 等）默认会先输出思维链，**很慢**。
网关默认注入 `thinking: {"type": "disabled"}` 跳过思考，只输出结果，**大幅提速**。
- 前端开关：提示词优化设置 → **关闭思考模式（大幅提速）**（默认勾选）
- 若某接口不认识该参数，网关会**自动去掉重试**，不会因此报错
- 环境变量 `DISABLE_THINKING=0` 可全局关掉此行为

新增 provider：在设置页「新增提供方」填 Base URL + Key，点「检测模型」下拉选择添加即可，无需改代码。

## 通知(可选但推荐)
网关通过 `termux-notification` 弹系统通知，点击/按钮用 `termux-open-url` 打开记录页。
```bash
pkg install termux-api          # 并安装 Termux:API App(F-Droid)
# 系统设置 → 应用 → Termux:API → 通知权限 → 允许
termux-notification --title 测试 --content 通了   # 手动验证
```
带按钮失败时会自动回退为纯文字通知；所有发送结果都记在 `server.log`（`notify: 已发送(带按钮)` 等）。

## 网络诊断(出 SSL/超时错误时先点它)
设置页 → 任选一个提供方 → **网络诊断**，会依次测：接口可达 → 小请求 → 大下载 → 大上传，并给出结论。

`BAD_RECORD_MAC` / `DECRYPTION_FAILED` / `EOF occurred` 这类错误的含义是 **TLS 数据在传输中被破坏**，
与生图模型无关，典型成因是 VPN/代理(如 FlClash) 传输较大数据包时出错——gpt-image 的响应是整图 base64
（1K 约 1~4 MB，4K 可达 10~25 MB），越大越容易触发。处理顺序：
1. **直接重试**（网关已自动重试 2 次；可用 `NET_RETRIES` 调整）
2. **换节点/换协议**
3. **FlClash 的 TUN MTU 调低到 1400 或 1280**
4. **关闭代理的 TLS 分片/嗅探等增强项**，或临时关代理直连测试
5. 换用较小尺寸/较低质量再试

## 环境变量(可选)
| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8765 | 网关端口 |
| `HOST` | 0.0.0.0 | 监听地址 |
| `MEDIA_DIR` | 自动 | 图片保存目录，默认写往 Termux 相册 |
| `DB_PATH` | ./history.db | 历史数据库路径 |
| `NET_RETRIES` | 2 | 传输层瞬时错误(SSL/断连/超时)的重试次数 |
| `DISABLE_THINKING` | 1 | 置 0 则不注入 thinking=disabled（文本模型思考模式） |
| `HTTP_UA` | SeedreamWeb/1.0 | 请求 User-Agent(部分 CDN 会拦截默认 Python UA) |
| `ARK_API_KEY` / `OPENAI_API_KEY` | 空 | 也可用环境变量代替 keys.json |

## 说明
- **存相册**：网关直接把图片写入 `~/storage/pictures/seedream-web`（即 `/sdcard/Pictures/seedream-web`），生成即进相册，不需要手动下载。
- **生成记录**：存在本机 SQLite `history.db`；删除记录会同时删除相册里的原图。
- **后台任务**：`POST /api/generate` 起线程，前端轮询 `/api/task/{id}`，因此生成期间可以切走。
- **提示词优化**：先用文本模型把用户需求扩成结构化的高质量英文 prompt，再喂给生图模型。

## 更新
```bash
cd ~/seedream-web && git pull origin main && bash manage.sh restart
```
