#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Seedream Web 本地网关 —— 纯标准库实现(无第三方编译依赖)
在 Termux/安卓: 只需 `pkg install python`, 无需 pip 编译任何 C/Rust 扩展。
前端 HTML 通过 localhost 访问, 网关负责对接多个 provider。
运行: python3 gateway.py   然后浏览器打开 http://localhost:8765
"""
import os, json, base64, sqlite3, time, uuid, re, mimetypes, io, threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "providers.json"
DEFAULT_CONFIG_PATH = BASE_DIR / "providers.default.json"
KEYS_PATH = BASE_DIR / "keys.json"
DB_PATH = Path(os.getenv("DB_PATH", BASE_DIR / "history.db"))
PORT = int(os.getenv("PORT", "8765"))
HOST = os.getenv("HOST", "0.0.0.0")
def _load_config():
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text("utf-8"))
        except Exception:
            pass
    if DEFAULT_CONFIG_PATH.exists():
        d = json.loads(DEFAULT_CONFIG_PATH.read_text("utf-8"))
        CONFIG_PATH.write_text(json.dumps(d, ensure_ascii=False, indent=2), "utf-8")
        return d
    return {}
CONFIG = _load_config()

# 后台任务状态(内存)
_jobs = {}
_jobs_lock = threading.Lock()

def _notify_cmd(cmd):
    try:
        import subprocess
        r = subprocess.run(cmd, capture_output=True, timeout=8)
        return r.returncode == 0
    except Exception as e:
        log(f"notify subprocess error: {e}")
        return False

def notify(title, content, url=None):
    """调用 termux-notification 弹系统通知(仅纯文字, 最稳)."""
    try:
        import shutil
        bin = shutil.which("termux-notification")
        if not bin:
            log("notify: 未找到 termux-notification（请先 pkg install termux-api）")
            return
        cmd = [bin, "--title", title, "--content", str(content)[:200]]
        if _notify_cmd(cmd):
            log("notify: 已发送")
        else:
            log("notify: 发送失败")
    except Exception as e:
        log(f"notify error: {e}")

def _run_job(task_id, body):
    try:
        t0 = time.time()
        res = generate(body); res["_status"] = "done"
        dur = int(time.time() - t0)
        model = (body.get("image_model") or "").rsplit("-", 1)[0]
        size = body.get("size") or ""
        msg = f"模型 {model} · 尺寸 {size} · 耗时 {dur} 秒 · 生成 {len(res.get('images') or [])} 张"
        with _jobs_lock:
            _jobs[task_id] = res
        notify("Seedream 生成完成", msg, "http://localhost:8765/#history")
    except Exception as e:
        res = {"_status": "failed", "error": str(e)[:300]}
        with _jobs_lock:
            _jobs[task_id] = res
        notify("Seedream 生成失败", f"{body.get('image_model','')} · {str(e)[:140]}", "http://localhost:8765/#history")

DEFAULT_OPT_PROMPT = (
    "你是一个专业的AI绘画提示词工程师。请把用户的中文/英文需求扩展成一段高质量、"
    "结构化、以英文为主的图像生成提示词, 依次包含: 主体、场景/背景、构图视角、光影色调、"
    "风格、画质细节。只输出优化后的提示词本身, 不要解释, 不要多余的说明文字。"
)
VISION_OPT_PROMPT = (
    "你是一个专业的AI绘画提示词工程师。用户提供了一张/几张参考图片和一段需求文字，"
    "请结合参考图的内容与用户需求，生成一段高质量、结构化、以英文为主的图像生成提示词。"
    "参考图是生成的主体依据：请准确描述图中主体、构图、视角、风格、光影、色调与细节，"
    "并将用户的补充/修改要求融入其中。只输出优化后的提示词本身，不要解释，不要多余说明。"
)
VISION_OPT_MSG = (
    "用户需求：\n{prompt}\n\n请以上面的参考图片为依据，生成一段与参考图一致、且能覆盖用户需求的优化提示词。"
)
DESC_OPT_PROMPT = (
    "你是一个专业的AI绘画提示词工程师。下面给出一段参考图的特征描述（中文）与用户需求，"
    "请结合二者，生成一段高质量、结构化、以英文为主的图像生成提示词。"
    "要体现参考图的主体、风格、构图与细节，并融入用户的补充要求。"
    "只输出优化后的提示词本身，不要解释。"
)
DESCRIBE_PROMPT = (
    "你是一个图像分析助手。请使用中文，按照用户指示，结合这些参考图"
    "（按第1张、第2张……顺序，与你上传顺序一致），分别说明每一张图在生成中的作用与要点"
    "（主体与特征、构图或姿态、场景背景、光影色调、风格与细节等）。"
    "请以【图1】【图2】… 分段输出，只输出描述本身，不要多余说明。"
)
CLEAN_RENDER_PROMPT = (
    "使用极其干净的角色卡渲染：连续清晰的线稿，平滑均匀的渐变，受控的平面色块，"
    "干净的轮廓，克制的纹理，细节清楚易读。头发缝隙和细小饰品保持自然通透，"
    "避免随机色点、彩色色斑、脏污纹理、压缩伪影、局部碎影和意外的脏色纹理。"
)
CLEAN_RENDER_SUFFIX = (
    " 只出现提示词明确要求的角色，不漏人、不复制、不融合；"
    "避免额外文字、Logo、水印、重复肢体或畸形手指。"
)
CLEAN_RENDER_SUFFIX = (
    " 只出现提示词明确要求的角色，不漏人、不复制、不融合；"
    "避免额外文字、Logo、水印、重复肢体或畸形手指。"
)
MULTI_REF_ROLE = (
    " The uploaded reference images are numbered in order. Image 1 defines the MAIN character's "
    "face, hair, eyes and primary outfit. Image 2 (and later images) provide ONLY the pose, "
    "composition, framing, camera angle and background, and must NOT change the character's identity "
    "from Image 1. Do NOT copy Image 2's character, face, outfit or identity. Combine them so the "
    "character from Image 1 is placed in the pose/composition of Image 2, without merging or swapping identities."
)

# ---------- 媒体目录(相册) ----------
def media_dir() -> Path:
    m = os.getenv("MEDIA_DIR")
    if m:
        p = Path(m)
    else:
        candidates = [
            Path.home() / "storage" / "pictures" / "seedream-web",
            Path("/sdcard") / "Pictures" / "seedream-web",
            BASE_DIR / "media",
        ]
        p = None
        for c in candidates:
            try:
                c.mkdir(parents=True, exist_ok=True)
                probe = c / (".p_" + uuid.uuid4().hex); probe.write_text("ok"); probe.unlink()
                p = c; break
            except Exception:
                continue
        if p is None:
            p = BASE_DIR / "media"; p.mkdir(parents=True, exist_ok=True)
    p.mkdir(parents=True, exist_ok=True)
    return p
MEDIA = media_dir()

# ---------- keys ----------
def load_keys() -> dict:
    data = {}
    if KEYS_PATH.exists():
        try: data = json.loads(KEYS_PATH.read_text("utf-8"))
        except Exception: data = {}
    out = {}
    envmap = {"byteplus": "ARK_API_KEY", "openai": "OPENAI_API_KEY"}
    for prov in CONFIG:
        envv = envmap.get(prov)
        val = ""
        if envv and os.getenv(envv): val = os.getenv(envv)
        elif data.get(prov): val = data.get(prov)
        out[prov] = val
    return out
def save_keys(keys):
    KEYS_PATH.write_text(json.dumps(keys, ensure_ascii=False, indent=2), "utf-8")
def get_provider(provider):
    if provider not in CONFIG:
        raise ValueError(f"未知 provider: {provider}")
    return CONFIG[provider]

# ---------- 数据库 ----------
def init_db():
    c = sqlite3.connect(DB_PATH)
    c.execute("""create table if not exists gen(
        id text primary key, ts real, provider text, model text,
        prompt text, optimized_prompt text, refs integer, size text,
        output text, status text)""")
    cols = [r[1] for r in c.execute("PRAGMA table_info(gen)").fetchall()]
    for col in ["quality", "opt_mode", "background", "format", "watermark"]:
        if col not in cols:
            c.execute(f"ALTER TABLE gen ADD COLUMN {col} TEXT")
    c.commit(); c.close()
def db(): return sqlite3.connect(DB_PATH)
def log(msg):
    try:
        with open(BASE_DIR / "server.log", "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} [gateway] {msg}\n")
    except Exception: pass

# ---------- 网络(urllib 标准库) ----------
def http_json(method, url, headers, body, timeout=180):
    data = json.dumps(body).encode() if body is not None else None
    req = Request(url, data=data, method=method, headers=headers)
    try:
        with urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}
def http_get(url, timeout=900):
    req = Request(url, method="GET")
    with urlopen(req, timeout=timeout) as r:
        return r.read()
def multipart(fields, files):
    b = "----sw" + uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    for (name, fname, blob, mime) in files:
        parts.append(f"--{b}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{fname}\"\r\nContent-Type: {mime}\r\n\r\n".encode() + blob + b"\r\n")
    parts.append(f"--{b}--\r\n".encode())
    return b"".join(parts), "multipart/form-data; boundary=" + b

# ---------- 提示词优化 ----------
def describe_image(provider, chat_model, key, refs, prompt=None, ref_roles=None):
    p = get_provider(provider); base = p["base_url"]
    refs = [r for r in (refs or []) if r]
    if not refs: raise ValueError("没有参考图")
    roles = ref_roles or ['auto']*len(refs)
    # 用户为每张图指定的作用
    role_lines = []
    for i, rl in enumerate(roles):
        role_lines.append(f"图{i+1}：{rl if rl and rl!='auto' else '(未指定，请按图自行判断)'}")
    instr = ("请根据以下用户指示，结合所有参考图（按第1张、第2张……顺序，与你上传顺序一致），"
             "用中文分别说明每一张图在生成中的作用与要点。\n各图指定作用：\n"
             + "\n".join(role_lines) + "\n用户指示：\n" + (prompt or "无附加指示"))
    content = [{"type": "text", "text": instr}]
    for r in refs:
        content.append({"type": "image_url", "image_url": {"url": r}})
    body = {"model": chat_model,
            "messages": [{"role": "system", "content": DESCRIBE_PROMPT}, {"role": "user", "content": content}],
            "temperature": 0.5}
    st, data = http_json("POST", f"{base}/chat/completions",
                         {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, body, timeout=300)
    if st != 200:
        raise RuntimeError(f"图像描述失败({st}): {json.dumps(data, ensure_ascii=False)[:300]}")
    return {"description": data["choices"][0]["message"]["content"].strip()}

def optimize_prompt(provider, chat_model, prompt, key, sys_prompt=None, refs=None, image_desc=None):
    p = get_provider(provider); base = p["base_url"]
    refs = [r for r in (refs or []) if r]
    sysc = (sys_prompt or (VISION_OPT_PROMPT if refs else (DESC_OPT_PROMPT if image_desc else DEFAULT_OPT_PROMPT))).strip()
    if refs:
        content = [{"type": "text", "text": VISION_OPT_MSG.format(prompt=prompt)}]
        for r in refs:
            content.append({"type": "image_url", "image_url": {"url": r}})
        message = {"role": "user", "content": content}
    elif image_desc:
        message = {"role": "user", "content": prompt + "\n\n【参考图特征描述】\n" + image_desc}
    else:
        message = {"role": "user", "content": prompt}
    body = {"model": chat_model,
            "messages": [{"role": "system", "content": sysc}, message],
            "temperature": 0.8}
    st, data = http_json("POST", f"{base}/chat/completions",
                         {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, body)
    if st != 200:
        raise RuntimeError(f"优化失败: {json.dumps(data, ensure_ascii=False)[:500]}")
    return data["choices"][0]["message"]["content"].strip()

# ---------- BytePlus 生图 ----------
def _is_sensitive_error(data):
    t = json.dumps(data, ensure_ascii=False)
    return ("SensitiveContentDetected" in t) or ("PolicyViolation" in t) or ("SensitiveContent" in t)
def _seed_size_ok(size):
    if size in ('1K','1.5K','2K','auto'): return True
    import re as _re
    return bool(_re.fullmatch(r'\d+\s*x\s*\d+', str(size or '')))
def gen_byteplus(p, key, model, prompt, refs, size, fmt, watermark, opt_mode=None, clean_render=False, retried=False):
    url = f"{p['base_url']}/images/generations"
    # 规范化 size: 非K档且非WxH 时映射为合法值(1024x1024), 避免 16:9 这类非法
    if not _seed_size_ok(size):
        m = str(size or '').lower()
        mapping = {'16:9':'1280x720','9:16':'720x1280','1:1':'1280x1280','3:4':'960x1280','4:3':'1280x960'}
        size = mapping.get(m, '1024x1024')

    if clean_render: prompt = prompt.strip() + CLEAN_RENDER_PROMPT
    if len([r for r in (refs or []) if r]) >= 2: prompt = prompt.strip() + MULTI_REF_ROLE
    body = {"model": model, "prompt": prompt, "size": size, "output_format": fmt,
            "response_format": "url", "watermark": watermark}
    if opt_mode: body["optimize_prompt_options"] = {"mode": opt_mode}
    imgs = [r for r in (refs or []) if r]
    if len(imgs) == 1: body["image"] = imgs[0]
    elif len(imgs) > 1: body["image"] = imgs
    st, data = http_json("POST", url, {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, body, timeout=900)
    if st != 200:
        # 若疑似内容安全误判且还没重试过, 去掉"干净渲染/伪影"后缀再试一次, 排除后缀引发误判的可能
        if _is_sensitive_error(data) and not retried and clean_render:
            log("sensitive_policy retry: dropping clean_render suffix")
            return gen_byteplus(p, key, model, prompt, refs, size, fmt, watermark, opt_mode, False, True)
        raise RuntimeError(f"生图失败: {json.dumps(data, ensure_ascii=False)[:800]}")
    out = []
    for it in data.get("data") or []:
        if it.get("url"): out.append({"url": it["url"]})
        elif it.get("b64_json"): out.append({"b64_json": it["b64_json"]})
    return out

# ---------- OpenAI 生图 ----------
OPENAI_DENOISE = (
    " | RENDER RULES (always enforce): ultra-clean unified rendering, continuous crisp linework, "
    "smooth even gradients, controlled flat color regions, clean silhouettes, restrained texture, "
    "readable details; keep hair gaps and thin accessories natural and open. "
    "No random color dots, no colored blotches, no dirty texture, no local broken fragments, "
    "no color bleeding, no compression artifacts, no AI watermark, no extra text."
)

def gen_openai(p, key, model, prompt, refs, size, fmt, watermark, opt_mode=None, quality=None, background=None, clean_render=False):
    base = p["base_url"]
    if clean_render: prompt = prompt.strip() + CLEAN_RENDER_PROMPT + CLEAN_RENDER_SUFFIX
    if len([r for r in (refs or []) if r]) >= 2: prompt = prompt.strip() + MULTI_REF_ROLE
    imgs = [r for r in (refs or []) if r]
    psize = preset_openai_size(size)
    # 干净渲染(开关控制)时追加去噪约束; 不开启则不加, 避免干扰用户提示词
    if clean_render:
        prompt = (prompt or "").rstrip() + " " + OPENAI_DENOISE
    extra = {}
    if quality: extra["quality"] = quality
    if fmt: extra["output_format"] = fmt
    if background: extra["background"] = background
    if not imgs:
        payload = {"model": model, "prompt": prompt, "n": 1, "response_format": "b64_json", "size": psize}
        payload.update(extra)
        st, data = http_json("POST", f"{base}/images/generations",
            {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, payload, timeout=900)
        if st != 200: raise RuntimeError(f"gpt-image: {json.dumps(data, ensure_ascii=False)[:800]}")
        return [{"b64_json": it.get("b64_json", "")} for it in data.get("data") or []]
    else:
        files = []
        for ref in imgs:
            name, blob, mime = resolve_ref_blob(ref)
            files.append(("image", name, blob, mime))
        fields = {"model": model, "prompt": prompt, "n": "1", "response_format": "b64_json", "size": psize}
        fields.update({k: str(v) for k, v in extra.items()})
        body, ctype = multipart(fields, files)
        req = Request(f"{base}/images/edits", data=body, method="POST",
                      headers={"Authorization": f"Bearer {key}", "Content-Type": ctype})
        try:
            with urlopen(req, timeout=900) as r: data = json.loads(r.read().decode())
            st = r.status
        except HTTPError as e:
            try: data = json.loads(e.read().decode())
            except Exception: data = {}
            st = e.code
        if st != 200: raise RuntimeError(f"gpt-image 编辑: {json.dumps(data, ensure_ascii=False)[:800]}")
        return [{"b64_json": it.get("b64_json", "")} for it in data.get("data") or []]
def preset_openai_size(size):
    n = (size or "auto").strip()
    if re.fullmatch(r"\d+\s*x\s*\d+", n):
        return n.replace(" ", "")
    allowed = {"auto", "1024x1024", "1536x1024", "1024x1536"}
    if n.lower() in allowed: return n.lower()
    if "16:9" in n: return "1536x1024"
    if "9:16" in n: return "1024x1536"
    return "1024x1024"
def resolve_ref_blob(ref):
    if ref.startswith("data:"):
        meta, b64 = ref.split(",", 1)
        mime = meta.split(";")[0].split(":")[1] or "image/png"
        ext = mime.split("/")[-1].replace("jpeg", "jpg")
        return f"ref.{ext}", base64.b64decode(b64), mime
    if ref.startswith("http"):
        blob = http_get(ref, timeout=120)
        mime = "image/png"; ext = "png"
        return f"ref.{ext}", blob, mime
    path = Path(ref); ext = path.suffix.lstrip(".") or "png"
    mime = "image/" + ext.replace("jpg", "jpeg")
    return path.name, path.read_bytes(), mime

REF_QUALITIES = (92, 88, 84, 80)
def _normalize_reference(data, mime, max_edge=2048, max_bytes=3*1024*1024):
    """统一为 RGB(透明铺白底)、LANCZOS 缩放、PNG 优先、JPEG 关闭色度子采样, 抑制串色/碎影."""
    try:
        import io as _io
        from PIL import Image
        img = Image.open(_io.BytesIO(data)); img.load()
        rgba = img.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.getchannel("A"))
        if max(flat.size) > max_edge:
            sc = max_edge / max(flat.size)
            flat = flat.resize((max(1, round(flat.width*sc)), max(1, round(flat.height*sc))), Image.Resampling.LANCZOS)
        out = _io.BytesIO(); flat.save(out, format="PNG", optimize=True)
        png = out.getvalue()
        if len(png) <= max_bytes:
            return "ref.png", png, "image/png"
        # PNG 超限 -> JPEG, 关闭色度子采样
        best = b""
        for q in REF_QUALITIES:
            o = _io.BytesIO(); flat.save(o, format="JPEG", quality=q, optimize=True, subsampling=0); best = o.getvalue()
            if len(best) <= max_bytes: break
        return "ref.jpg", best, "image/jpeg"
    except Exception:
        return None, data, mime

def _dedupe_refs(refs):
    """按 sha256 去重, 去除重复/占位参考图, 并返回(清洗后refs, 警告)."""
    import hashlib
    seen=set(); clean=[]; warnings=[]
    for r in refs:
        if not r: continue
        b = base64.b64decode(r.split(",",1)[1]) if r.startswith("data:") else None
        if b is None: continue
        if len(b)==0: continue
        d = hashlib.sha256(b).hexdigest()
        if d in seen: warnings.append("duplicate_skipped"); continue
        seen.add(d); clean.append(r)
    return clean, warnings

# ---------- 保存输出 ----------
def _looks_like_png(blob):
    return blob[:8] == b"\x89PNG\r\n\x1a\n"
def save_outputs(items, idp):
    saved = []
    for i, it in enumerate(items):
        if it.get("url") is not None:
            blob = http_get(it["url"])
        else:
            blob = base64.b64decode(it.get("b64_json") or "")
        if i == 0 and not _looks_like_png(blob):
            if not blob.startswith((b"\xff\xd8\xff", b"GIF8", b"RIFF")):
                log(f"save_outputs: first item is not an image (len={len(blob)}), skipping")
                continue
        ext = "png"
        fn = f"{idp}_{i}.{ext}"
        (MEDIA / fn).write_bytes(blob)
        # 记录文件大小(MB)与实际像素
        w=h=0
        try:
            import io as _io
            from PIL import Image
            img=Image.open(_io.BytesIO(blob)); w,h=img.size
        except Exception:
            pass
        saved.append({"file": fn, "mb": round(len(blob)/1024/1024, 2), "w": w, "h": h})
    return saved

# ---------- 业务方法 ----------
PREFS_PATH = BASE_DIR / "prefs.json"
def load_prefs():
    try:
        d = json.loads(PREFS_PATH.read_text("utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}
def save_prefs(prefs):
    PREFS_PATH.write_text(json.dumps(prefs, ensure_ascii=False, indent=2), "utf-8")
def prefs_get():
    return load_prefs()
def prefs_put(body):
    save_prefs(body); return {"ok": True}
def models():
    return {prov: {"label": p.get("label", prov), "image_models": p.get("image_models", []),
                   "chat_models": p.get("chat_models", [])} for prov, p in CONFIG.items()}
def config_get():
    return CONFIG
def config_put(body):
    global CONFIG
    if not isinstance(body, dict) or not body:
        raise ValueError("配置不能为空")
    CONFIG = body
    CONFIG_PATH.write_text(json.dumps(body, ensure_ascii=False, indent=2), "utf-8")
    return {"ok": True}
def detect_models(body):
    provider = body.get("provider") or ""
    base = body.get("base_url") or (CONFIG.get(provider, {}).get("base_url") if provider else "")
    key = body.get("api_key") or load_keys().get(provider, "")
    if not base: raise ValueError("缺少 Base URL")
    if not key: raise ValueError("需要该服务方的 API Key")
    url = base.rstrip("/") + "/models"
    st, data = http_json("GET", url, {"Authorization": f"Bearer {key}"}, None)
    if st != 200:
        msg = (data.get("error", {}).get("message") if isinstance(data, dict) and isinstance(data.get("error"), dict) else str(data))[:200] if data else "(无返回)"
        if st in (401, 403):
            # 生图可用却列模型403/401: 很可能是该中转不开放 /models 或需特殊权限; Key 可能有效
            return {"models": [], "unsupported": True,
                    "message": f"未能列出模型(HTTP {st})：{msg}。该接口可能未开放列模型；生图 Key 若可用，请点「连接测试」验证模型连通，或点「手动」添加模型。"}
        return {"models": [], "unsupported": True,
                "message": f"接口异常(HTTP {st})：{msg}。该中转可能不支持列出模型，或路径不对。"}
    ids = [m.get("id") for m in (data.get("data") or []) if m.get("id")]
    return {"models": ids, "unsupported": False, "message": f"检测到 {len(ids)} 个模型"}
def test_connection(body):
    provider = body.get("provider") or ""
    base = body.get("base_url") or (CONFIG.get(provider, {}).get("base_url") if provider else "")
    key = body.get("api_key") or load_keys().get(provider, "")
    model = body.get("model")
    if not base: raise ValueError("缺少 Base URL")
    if not key: raise ValueError("需要该服务方的 API Key")
    url = base.rstrip("/") + "/models"
    st, data = http_json("GET", url, {"Authorization": f"Bearer {key}"}, None)
    if st != 200:
        # 列模型失败但可能 Key 有效: 尝试用已有模型发最小请求判断
        if model:
            try:
                st2, d2 = http_json("POST", base.rstrip("/") + "/chat/completions",
                                    {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                                    {"model": model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
                                    timeout=60)
                if st2 == 200:
                    return {"ok": True, "status": st, "message": f"该接口未开放列模型(HTTP {st})，但模型可调用 ✅ (Key 有效)", "model_count": 0}
            except Exception:
                pass
        return {"ok": False, "status": st,
                "message": f"连接异常(HTTP {st})，请检查 Base URL/Key: {json.dumps(data, ensure_ascii=False)[:160]}"}
    n = len(data.get("data") or [])
    msg = f"连接成功 ✅ (Key 有效) · 返回 {n} 个模型"
    if model:
        try:
            st2, d2 = http_json("POST", base.rstrip("/") + "/chat/completions",
                                {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                                {"model": model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
                                timeout=60)
            msg += ("；模型可调用 ✅" if st2 == 200 else f"；模型调用失败(HTTP {st2})")
        except Exception as e:
            msg += f"；模型测试异常: {str(e)[:80]}"
    return {"ok": True, "status": st, "message": msg, "model_count": n}
def settings():
    keys = load_keys()
    return {"providers": {k: {"has_key": bool(v)} for k, v in keys.items()}}
def set_settings(body):
    cur = load_keys()
    for k, v in (body.get("keys") or {}).items():
        if k in cur and v is not None: cur[k] = str(v).strip()
    save_keys(cur); return {"ok": True}
def optimize(body):
    provider = body["provider"]; cm = body["chat_model"]; prompt = body["prompt"]
    key = load_keys().get(provider)
    if not key: raise ValueError(f"请先在设置里填写 {provider} 的 API Key")
    desc = body.get("image_desc")
    refs = body.get("refs") or []
    if desc:
        refs = None   # 已用文字描述代替图片
    return {"optimized_prompt": optimize_prompt(provider, cm, prompt, key,
             body.get("optimize_prompt"), refs if body.get("use_vision") else None, desc)}
def generate(body):
    provider = body["provider"]; im = body["image_model"]; prompt = body["prompt"]
    orig = body.get("original_prompt") or body.get("prompt") or ""
    refs = body.get("refs") or []; size = body.get("size", "1.5K")
    fmt = body.get("output_format", "png"); wm = bool(body.get("watermark", False))
    opt = bool(body.get("optimize", False)); cm = body.get("chat_model")
    chat_provider = body.get("chat_provider") or provider
    p = get_provider(provider); key = load_keys().get(provider)
    if not key: raise ValueError(f"请先在设置里填写 {provider} 的 API Key")
    log(f"generate start | provider={provider} model={im} refs={len([r for r in refs if r])} "
        f"size={size} optimize={opt} vision={bool(body.get('use_vision'))}")
    final = prompt
    if opt:
        if not cm: raise ValueError("优化提示词需要选择文本模型")
        ckey = load_keys().get(chat_provider)
        if not ckey: raise ValueError(f"请先在设置里填写 {chat_provider} 的 API Key（用于提示词优化）")
        log(f"optimizing with {chat_provider}/{cm} ...")
        final = optimize_prompt(chat_provider, cm, prompt, ckey, body.get("optimize_prompt"),
                                refs if body.get("use_vision") else None)
        log(f"optimized, len={len(final)}")
        hist_opt = final
    else:
        final = body.get("pre_optimized_prompt") or prompt
        hist_opt = body.get("pre_optimized_prompt") or None
    log(f"calling image model {im} ... opt_mode={body.get('opt_mode')} quality={body.get('quality')} bg={body.get('background')} clean={body.get('clean_render')}")
    # 参考图处理: 按 provider 区分
    #  - BytePlus/Seedream: 压缩归一化(可选, 由 body['compress'] 控制), 否则太慢
    #  - OpenAI/gpt-image: 尽量不压缩, 直接用原图(去重), 保留细节; 质量开关交给 quality
    compress = bool(body.get('compress'))
    is_openai = (provider != 'byteplus')
    norm = []
    for r in (refs or []):
        name, blob, mime = resolve_ref_blob(r)
        # 去重(先解码字节)
        if compress or True:
            # 先做字节级去重
            pass
        if is_openai and not compress:
            # gpt-image: 保留原图, 不做降采样; 若 base64 过大仍可轻归一化, 此处保持原样
            norm.append(r if r.startswith('data:') else f"data:{mime};base64," + base64.b64encode(blob).decode())
        else:
            n_name, n_blob, n_mime = _normalize_reference(blob, mime)
            norm.append(f"data:{n_mime};base64," + base64.b64encode(n_blob if n_blob else blob).decode())
    refs, warn = _dedupe_refs(norm)
    if warn: log(f"ref dedupe warnings: {warn}")
    # 按用户为每张图指定的作用, 生成分工说明并注入生图 prompt(多图时)
    roles = body.get('ref_roles') or []
    use_role_prompt = bool(roles) and any(rl and rl!='auto' for rl in roles) and len(refs) >= 2
    if use_role_prompt:
        lines=[]
        for i,rl in enumerate(roles[:len(refs)]):
            if rl and rl!='auto':
                lines.append(f"Image {i+1} = {rl}")   # Image N 的作用
        if lines:
            role_prompt = " Reference image roles: " + "; ".join(lines) +                 ". Strictly follow these roles: use each Image ONLY for its assigned role, do not swap or merge identities/features between images."
            final = final.strip() + role_prompt
            log(f"injected ref_roles: {role_prompt[:120]}")
    if provider == "byteplus":
        items = gen_byteplus(p, key, im, final, refs, size, fmt, wm, body.get("opt_mode"), body.get("clean_render"))
    else:
        items = gen_openai(p, key, im, final, refs, size, fmt, wm, body.get("opt_mode"),
                           body.get("quality"), body.get("background"), body.get("clean_render"))
    log(f"image model returned {len(items)} item(s)")
    gid = uuid.uuid4().hex
    saved = save_outputs(items, gid)
    log(f"saved files: {saved}")
    c = db()
    c.execute("""insert into gen(id,ts,provider,model,prompt,optimized_prompt,refs,size,output,status,quality,opt_mode,background,format,watermark)
                 values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (gid, time.time(), provider, im, orig, hist_opt, len([r for r in refs if r]), size,
               json.dumps({"files": saved}, ensure_ascii=False), "ok",
               body.get("quality"), body.get("opt_mode"), body.get("background"),
               body.get("output_format"), body.get("watermark")))
    c.commit(); c.close()
    imgs_out=[]
    for f in saved:
        if isinstance(f, dict):
            imgs_out.append({"url": f"/img/{f['file']}", "download": f"/img/{f['file']}", "mb": f.get('mb'), "w": f.get('w'), "h": f.get('h')})
        else:
            imgs_out.append({"url": f"/img/{f}", "download": f"/img/{f}"})
    return {"id": gid, "files": saved, "optimized_prompt": final if opt else None,
            "final_prompt": final,
            "images": imgs_out}
def history():
    c = db(); rows = c.execute("select id,ts,provider,model,prompt,optimized_prompt,refs,size,output,status,quality,opt_mode,background,format,watermark from gen order by ts desc").fetchall(); c.close()
    out = []
    for r in rows:
        files = json.loads(r[8] or "{}").get("files", [])
        imgs=[]
        first_meta={}
        for f in files:
            fname = f if isinstance(f, str) else f.get('file')
            mb = f.get('mb') if isinstance(f, dict) else None
            w = f.get('w') if isinstance(f, dict) else None
            h = f.get('h') if isinstance(f, dict) else None
            # 从文件实时读取尺寸/大小兜底(不依赖保存时记录)
            if (mb is None or not w or not h) and fname:
                fp = MEDIA / fname
                if fp.exists():
                    try:
                        mb = round(fp.stat().st_size/1024/1024, 2)
                        import io as _io
                        from PIL import Image
                        img = Image.open(_io.BytesIO(fp.read_bytes())); w, h = img.size; img.close()
                    except Exception:
                        pass
            meta = {'file': fname, 'mb': mb, 'w': w, 'h': h}
            if not first_meta: first_meta = meta
            imgs.append({"url": f"/img/{fname}", "download": f"/img/{fname}", "mb": mb, "w": w, "h": h})
        out.append({"id": r[0], "ts": r[1], "provider": r[2], "model": r[3], "prompt": r[4],
                    "optimized_prompt": r[5], "refs": r[6], "size": r[7], "status": r[9],
                    "quality": r[10], "opt_mode": r[11], "background": r[12],
                    "format": r[13], "watermark": r[14],
                    "img_mb": first_meta.get('mb'), "img_w": first_meta.get('w'), "img_h": first_meta.get('h'),
                    "images": imgs})
    return out
def del_history(gid):
    c = db(); row = c.execute("select output from gen where id=?", (gid,)).fetchone()
    files = json.loads(row[0] or "{}").get("files", []) if row else []
    c.execute("delete from gen where id=?", (gid,)); c.commit(); c.close()
    for f in files:
        try: (MEDIA / f).unlink(missing_ok=True)
        except Exception: pass
    return {"ok": True}

def del_history_many(ids):
    n = 0
    for gid in (ids or []):
        try:
            del_history(gid); n += 1
        except Exception:
            pass
    return {"ok": True, "deleted": n}

# ---------- HTTP ----------
class H(BaseHTTPRequestHandler):
    server_version = "SeedreamWeb/1.0"
    def log_message(self, fmt, *args):
        try:
            with open(BASE_DIR / "server.log", "a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {self.client_address[0]} {fmt % args}\n")
        except Exception:
            pass
    def _send(self, status, payload, ctype=None):
        if isinstance(payload, (dict, list)):
            data = json.dumps(payload, ensure_ascii=False).encode(); ctype = "application/json; charset=utf-8"
        elif isinstance(payload, str):
            data = payload.encode(); ctype = ctype or "text/plain; charset=utf-8"
        else:
            data = payload; ctype = ctype or "application/octet-stream"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers(); self.wfile.write(data)
    def _read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n == 0: return {}
        return json.loads(self.rfile.read(n).decode())
    def do_GET(self):
        path = self.path.split("?")[0]
        try:
            if path == "/":
                self._send(200, (BASE_DIR / "index.html").read_bytes(), "text/html; charset=utf-8")
            elif path == "/manifest.json":
                self._send(200, (BASE_DIR / "manifest.json").read_bytes(), "application/manifest+json; charset=utf-8")
            elif path == "/sw.js":
                self._send(200, (BASE_DIR / "sw.js").read_bytes(), "application/javascript; charset=utf-8")
            elif path == "/api/health": self._send(200, {"ok": True, "time": time.strftime("%H:%M:%S")})
            elif path == "/api/models": self._send(200, models())
            elif path == "/api/config": self._send(200, config_get())
            elif path == "/api/prefs": self._send(200, prefs_get())
            elif path == "/api/settings": self._send(200, settings())
            elif path == "/api/history": self._send(200, history())
            elif path == "/api/tasks":
                with _jobs_lock:
                    running = [{"id": tid, "model": (j.get("body") or {}).get("image_model") or "", "status": j.get("_status")}
                               for tid, j in _jobs.items() if j.get("_status") in ("pending", "running")]
                self._send(200, {"running": running})
            elif path.startswith("/api/task/"):
                tid = path.split("/api/task/")[1]
                with _jobs_lock: job = _jobs.get(tid)
                if job is None: self._send(404, {"error": "not found"})
                else: self._send(200, job)
            elif path.startswith("/static/"):
                rel = path[len("/static/"):]
                f = (BASE_DIR / "static" / rel).resolve()
                if str(f).startswith(str((BASE_DIR / "static").resolve())) and f.is_file():
                    self._send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or "application/octet-stream")
                else:
                    self._send(404, {"error": "not found"})
            elif path.startswith("/img/"):
                f = MEDIA / path.split("/img/")[1]
                if f.exists():
                    self._send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or "application/octet-stream")
                else: self._send(404, {"error": "not found"})
            else: self._send(404, {"error": "not found"})
        except Exception as e:
            self._send(500, {"error": str(e)})
    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            body = self._read_json()
            if path == "/api/settings": self._send(200, set_settings(body))
            elif path == "/api/optimize": self._send(200, optimize(body))
            elif path == "/api/describe":
                key = load_keys().get(body.get("provider"))
                if not key: raise ValueError(f"请先在设置里填写 {body.get('provider')} 的 API Key")
                self._send(200, describe_image(body["provider"], body["chat_model"], key, body.get("refs") or [], body.get("prompt"), body.get("ref_roles")))
            elif path == "/api/history/batch":
                ids = body.get("ids") or [] if isinstance(body, dict) else []
                self._send(200, del_history_many(ids))
            elif path == "/api/generate":
                task_id = uuid.uuid4().hex
                with _jobs_lock: _jobs[task_id] = {"_status": "pending", "body": body}
                threading.Thread(target=_run_job, args=(task_id, body), daemon=True).start()
                self._send(200, {"task_id": task_id})
            elif path == "/api/detect": self._send(200, detect_models(body))
            elif path == "/api/test": self._send(200, test_connection(body))
            else: self._send(404, {"error": "not found"})
        except ValueError as e:
            log(f"ERROR {path}: {e}")
            self._send(400, {"detail": str(e)})
        except Exception as e:
            log(f"ERROR {path}: {e}")
            self._send(500, {"detail": str(e)})
    def do_PUT(self):
        path = self.path.split("?")[0]
        try:
            body = self._read_json()
            if path == "/api/config": self._send(200, config_put(body))
            elif path == "/api/prefs": self._send(200, prefs_put(body))
            else: self._send(404, {"error": "not found"})
        except ValueError as e:
            self._send(400, {"detail": str(e)})
        except Exception as e:
            self._send(500, {"detail": str(e)})
    def do_DELETE(self):
        m = re.match(r"/api/history/(.+)$", self.path.split("?")[0])
        if m: self._send(200, del_history(m.group(1)))
        else: self._send(404, {"error": "not found"})

if __name__ == "__main__":
    init_db()
    print("=" * 58)
    print("  Seedream Web Gateway (纯标准库)")
    print(f"  相册目录: {MEDIA}")
    print(f"  浏览器访问: http://localhost:{PORT}")
    print("=" * 58)
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
