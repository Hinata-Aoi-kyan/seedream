<<<<<<< HEAD
# Seedream Web · 手机本地生图网关

一个跑在 **手机 Termux**（或任何 Python 环境）里的本地网关 + 网页界面。
浏览器打开 `localhost:8765` 即可：选图做**多参考图生图**、接入**多个 API / 不同模型**、**生成记录**、结果**自动存相册**。

## 为什么要有这个网关
- AI 接口（尤其 BytePlus 生图）**不允许浏览器直接跨域调用**（CORS 预检不放开 `Authorization` 头），纯网页直连会报跨域错。
- 因此由**手机上的网关**来发起请求（服务端到云端，无跨域），网页只访问本机 `localhost`（同源，无 CORS）。
- **API Key 只存手机本机 `keys.json`**，既不暴露给前端页面，也不外泄。

## 目录结构
```
seedream-web/
├── gateway.py        # 本地网关 (FastAPI)，负责多 provider 转发、存图、历史库
├── index.html        # 前端界面(单文件)
├── providers.json    # 各 provider / 模型的配置
├── requirements.txt  # pip 依赖
├── static/           # 静态资源(可留空)
└── README.md
```

## 手机 (Termux) 运行步骤
```bash
# 1) 安装 Termux(F-Droid 版, 勿用 Play 版) 后:
pkg update && pkg install python -y
termux-setup-storage        # 授权访问相册(必须, 结果图才进相册)
pip install -U pip
pip install fastapi uvicorn requests pillow

# 2) 把 seedream-web 文件夹拷到手机(如放 ~/storage/downloads/)
#    进入目录
cd ~/storage/downloads/seedream-web

# 3) 启动网关
python3 gateway.py
# 看到提示后, 用手机浏览器打开:
#   http://localhost:8765
```

## 首次使用
1. 点右上角 **🔑 设置**，填入各 provider 的 API Key：
   - **BytePlus / 火山方舟**：`ARK_API_KEY`（在 ai.byteplus.com 生成）
   - **OpenAI**：`OPENAI_API_KEY`
2. 回到主页，输入提示词，可选开启 **✨ 优化提示词**（用 DeepSeek / GPT 文本模型扩写）。
3. **参考图**：点"＋选择参考图"可多选（最多 10 张，按顺序融合）；本地图自动转 base64，也可粘贴 URL。
4. 选择生图模型与尺寸 → **🚀 生成**。
5. 结果自动保存到手机相册 `Pictures/seedream-web/`，并出现在下方 **📚 生成记录**，可查看/下载/删除。

## 支持的模型(在 providers.json 里改)
- **BytePlus / 火山方舟**
  - 生图：`dola-seedream-5-0-pro-260628`（Seedream 5.0 Pro，最多 10 张参考图）、`seedream-5-0`（Lite）
  - 文本：`deepseek-r1-250528`（DeepSeek R1）、`deepseek-v3-0324`（DeepSeek V3）
- **OpenAI**
  - 生图：`gpt-image-1`（文生图 + 图生图编辑，`/images/edits`）
  - 文本：`gpt-4o`

新增 provider：在 `providers.json` 追加一个 provider，并在 `gateway.py` 的 `gen` 字典和 `load_keys` 的 `envmap` 里加对应适配即可。

## 环境变量(可选)
| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8765 | 网关端口 |
| `HOST` | 0.0.0.0 | 监听地址 |
| `MEDIA_DIR` | 自动 | 图片保存目录，默认写往 Termux 相册 |
| `DB_PATH` | ./history.db | 历史数据库路径 |
| `ARK_API_KEY` / `OPENAI_API_KEY` | 空 | 也可用环境变量代替 keys.json |

## 说明
- **存相册**：网关直接把图片写入 `~/storage/pictures/seedream-web`（即 `/sdcard/Pictures/seedream-web`），所以你**不需要手动下载**，生成即进相册。
- **生成记录**：存在本机 SQLite `history.db`，图片原图保留在 `Pictures/seedream-web`，网页里可随时回看。
- **提示词优化**：先用文本模型把用户需求扩成结构化的高质量英文 prompt，再喂给生图模型（两段式串联）。
=======
# seedream
>>>>>>> origin/main
