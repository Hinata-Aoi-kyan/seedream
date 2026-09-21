/* ============================================================
 * Seedream —— APK 自包含后端 (方案 C)
 * 网页版不会加载此文件的逻辑(由 isNative 判断)。
 * 作用: 在 APK 内用 CapacitorHttp 直连云端 API(原生请求, 无 CORS),
 *       用 Filesystem 存图, localStorage 存配置/历史, 不监听任何端口。
 * ============================================================ */
(function () {
  'use strict';

  // 注意: Capacitor 的桥接脚本可能在我们的脚本之后注入,
  // 因此绝不能在这里取 window.Capacitor —— 全部延迟到调用时判断。
  function cap() { try { return window.Capacitor || null; } catch (e) { return null; } }
  function PL(name) { try { const c = cap(); return (c && c.Plugins && c.Plugins[name]) || null; } catch (e) { return null; } }
  function isNative() { try { const c = cap(); return !!(c && c.isNativePlatform && c.isNativePlatform()); } catch (e) { return false; } }
  function convertFileSrc(p) { try { const c = cap(); return c && c.convertFileSrc ? c.convertFileSrc(p) : p; } catch (e) { return p; } }

  // ---------- 简易存储 ----------
  const SK = {
    keys: 'sw_n_keys', cfg: 'sw_n_cfg', hist: 'sw_n_hist', prefs: 'sw_n_prefs',
  };
  function Sget(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function Sset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------- 配置(首次从随包默认配置初始化) ----------
  let CFG = Sget(SK.cfg, null);
  async function ensureCfg() {
    if (CFG && Object.keys(CFG).length) return CFG;   // 空对象视为未初始化
    try {
      const r = await fetch('/providers.default.json');
      CFG = await r.json();
    } catch (e) { CFG = {}; }
    Sset(SK.cfg, CFG);
    return CFG;
  }

  // ---------- Key ----------
  function K() { return Sget(SK.keys, {}); }
  function setKey(p, v) { const k = K(); if (v === '' || v == null) delete k[p]; else k[p] = String(v).trim(); Sset(SK.keys, k); }
  function keyOf(p) { return K()[p] || ''; }

  // ---------- HTTP (CapacitorHttp 原生请求, 不受 CORS 限制) ----------
  async function http(method, url, headers, data, timeoutMs) {
    const to = timeoutMs || 300000;
    const CH = PL('CapacitorHttp');
    if (CH) {
      const res = await CH.request({
        method: method, url: url, headers: headers || {},
        data: data, connectTimeout: to, readTimeout: to,
      });
      let body = res.data;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }
      return { status: res.status, data: body, raw: res.data };
    }
    // 兜底: 普通 fetch (APK 里一般用不到)
    const r = await fetch(url, {
      method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
      body: data == null ? undefined : (typeof data === 'string' ? data : JSON.stringify(data)),
    });
    const txt = await r.text();
    let j = txt; try { j = JSON.parse(txt); } catch (e) {}
    return { status: r.status, data: j, raw: txt };
  }
  async function httpJson(method, url, headers, data, timeoutMs) {
    const tries = [0, 1, 2];
    let last = '';
    for (let i = 0; i < tries.length; i++) {
      try {
        const r = await http(method, url, headers, data, timeoutMs);
        if (r.status >= 200 && r.status < 300) return r;
        last = 'HTTP ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 300);
        // 4xx 不重试
        if (r.status >= 400 && r.status < 500) return r;
      } catch (e) { last = String(e && e.message || e); }
      if (i < 2) await sleep(1200 * (i + 1));
    }
    return { status: 0, data: { error: last } };
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function errText(d) {
    if (!d) return '未知错误';
    if (typeof d === 'string') return d.slice(0, 400);
    const e = d.error || d;
    if (typeof e === 'string') return e.slice(0, 400);
    return (e.message || JSON.stringify(d)).slice(0, 400);
  }

  // ---------- 文本模型(优化/描述) ----------
  const DEFAULT_OPT = '你是一个专业的AI绘画提示词工程师。请把用户的中文/英文需求扩展成一段高质量、结构化、以英文为主的图像生成提示词, 依次包含: 主体、场景/背景、构图视角、光影色调、风格、画质细节。只输出优化后的提示词本身, 不要解释, 不要多余的说明文字。';
  const VISION_OPT = '你是一个专业的AI绘画提示词工程师。用户提供了一张/几张参考图片和一段需求文字，请结合参考图的内容与用户需求，生成一段高质量、结构化、以英文为主的图像生成提示词。参考图是生成的主体依据：请准确描述图中主体、构图、视角、风格、光影、色调与细节，并将用户的补充/修改要求融入其中。只输出优化后的提示词本身，不要解释、不要多余说明。';
  const EDIT_OPT = '你是一个AI图像局部编辑（inpainting / 局部重绘）指令专家。用户会给出一个【局部修改需求】，需要改写成一句精准、简短的英文编辑指令。要求：\n1. 只描述被选中区域应该变成什么：颜色、材质、内容、风格、文字等具体变化；\n2. 明确指出这是局部修改，并强调 keep the rest of the image unchanged；\n3. 绝不扩写成整张画面的完整描述——不要添加背景、构图、光影、镜头等无关内容；\n4. 长度控制在 15~50 个英文单词，越精准越短越好；\n5. 只输出改写后的指令本身，不要解释、不要加引号、不要输出多段。';
  const DESCRIBE_P = '你是一个图像分析助手。请使用中文，按照用户指示，结合这些参考图（按第1张、第2张……顺序，与你上传顺序一致），分别说明每一张图在生成中的作用与要点（主体与特征、构图或姿态、场景背景、光影色调、风格与细节等）。请以【图1】【图2】… 分段输出，只输出描述本身，不要多余说明。';

  async function chat(body, timeoutMs) {
    const prov = body.__provider;
    const p = CFG[prov];
    const base = (p && p.base_url || '').replace(/\/+$/, '');
    if (!base) throw new Error('服务方「' + prov + '」没有 Base URL，请到设置里检查');
    let key = keyOf(prov);
    if (!key) {
      // 兜底: 同 base_url 的其它提供方有 Key 也能用
      try {
        for (const pk of Object.keys(CFG || {})) {
          if (pk === prov) continue;
          const pu = String((CFG[pk] || {}).base_url || '').replace(/\/+$/, '');
          if (pu && pu === base && keyOf(pk)) { key = keyOf(pk); break; }
        }
      } catch (e) {}
    }
    if (!key) throw new Error('请先在设置里填写「' + prov + '」的 API Key');

    // 逐级降级: 带 thinking+temperature -> 去 thinking -> 再去 temperature -> 最简 {model, messages}
    const variants = [];
    const v1 = { model: body.__model, messages: body.messages };
    if (body.temperature != null) v1.temperature = body.temperature;
    if (body.__thinking !== false) v1.thinking = { type: 'disabled' };
    variants.push(v1);
    if (v1.thinking) { const v = Object.assign({}, v1); delete v.thinking; variants.push(v); }
    if (v1.temperature != null) { const v = Object.assign({}, v1); delete v.thinking; delete v.temperature; variants.push(v); }
    variants.push({ model: body.__model, messages: body.messages });   // 最简: 排除一切参数因素

    let last = null, tried = [];
    for (let i = 0; i < variants.length; i++) {
      const r = await httpJson('POST', base + '/chat/completions',
        { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }, variants[i], timeoutMs || 300000);
      tried.push('#' + (i + 1) + '=' + r.status);
      if (r.status === 200) {
        const d = r.data || {};
        const msg = ((d.choices || [{}])[0].message || {});
        const txt = msg.content || msg.reasoning_content || '';
        if (txt) return String(txt).trim();
        throw new Error('模型返回为空（模型=' + body.__model + '）');
      }
      last = r;
      // 只在 4xx(参数/权限类) 时继续降级; 5xx/网络错直接停下重试没意义
      if (r.status < 400 || r.status >= 500) break;
    }
    throw new Error('模型调用失败(HTTP ' + (last && last.status) + '，模型=' + body.__model + '，尝试=' + tried.join(',') + '): '
      + errText(last && last.data)
      + hint403(last && last.status, base));
  }

  /** 403: 同一 Key 能列模型却调不动某个模型时, 基本是 Key 的模型权限范围问题 */
  function hint403(status, base) {
    if (status !== 403) return '';
    return '\n\n【403 说明】同一个 Key 能列出模型、却调用不了这个模型 —— 通常是这个 API Key 的「模型权限范围」'
      + '没包含该模型（很多平台的 Key 可以只绑定部分模型）。\n'
      + '请到控制台检查：该 API Key 是否限制了可用模型 / 是否已为该模型开通调用权限。\n'
      + '也可以先用同平台另一个已确认能用的模型对比测试。';
  }

  async function optimize(body) {
    const sysc = body.optimize_prompt || (body.for_edit ? EDIT_OPT : (body.use_vision && (body.refs || []).length ? VISION_OPT : DEFAULT_OPT));
    const content = [];
    if (body.use_vision && (body.refs || []).length) {
      content.push({ type: 'text', text: '用户需求：\n' + body.prompt + '\n\n请以上面的参考图片为依据，生成一段与参考图一致、且能覆盖用户需求的优化提示词。' });
      (body.refs || []).forEach(function (r) { if (r) content.push({ type: 'image_url', image_url: { url: r } }); });
    } else if (body.image_desc) {
      content.push({ type: 'text', text: body.prompt + '\n\n【参考图特征描述】\n' + body.image_desc });
    } else {
      content.push({ type: 'text', text: body.prompt });
    }
    const out = await chat({ __provider: body.provider, __model: body.chat_model, temperature: 0.8,
      __thinking: body.disable_thinking, messages: [{ role: 'system', content: sysc }, { role: 'user', content: content.length > 1 ? content : content[0].text }] });
    return { optimized_prompt: out.trim() };
  }
  async function describe(body) {
    const refs = (body.refs || []).filter(Boolean);
    if (!refs.length) throw new Error('没有参考图');
    const roles = body.ref_roles || [];
    const lines = refs.map(function (_, i) { const rl = roles[i]; return '图' + (i + 1) + '：' + (rl && rl !== 'auto' ? rl : '(未指定，请按图自行判断)'); });
    const instr = '请根据以下用户指示，结合所有参考图，用中文分别说明每一张图在生成中的作用与要点。\n各图指定作用：\n' + lines.join('\n') + '\n用户指示：\n' + (body.prompt || '无附加指示');
    const content = [{ type: 'text', text: instr }];
    refs.forEach(function (r) { content.push({ type: 'image_url', image_url: { url: r } }); });
    const out = await chat({ __provider: body.provider, __model: body.chat_model, temperature: 0.5,
      __thinking: body.disable_thinking, messages: [{ role: 'system', content: DESCRIBE_P }, { role: 'user', content: content }] });
    return { description: out.trim() };
  }

  // ---------- 生图 ----------
  function seedSizeOk(s) { return ['1K', '1.5K', '2K', 'auto'].indexOf(s) >= 0 || /^\d+\s*x\s*\d+$/.test(String(s || '')); }
  function mapSeedSize(s) {
    if (seedSizeOk(s)) return s;
    const m = { '16:9': '1280x720', '9:16': '720x1280', '1:1': '1280x1280', '3:4': '960x1280', '4:3': '1280x960' };
    return m[String(s || '').toLowerCase()] || '1024x1024';
  }
  function presetOpenaiSize(s) {
    const n = String(s || 'auto').trim();
    if (/^\d+\s*x\s*\d+$/.test(n)) return n.replace(/\s/g, '');
    const low = n.toLowerCase();
    if (['auto', '1024x1024', '1536x1024', '1024x1536'].indexOf(low) >= 0) return low;
    if (n.indexOf('16:9') >= 0) return '1536x1024';
    if (n.indexOf('9:16') >= 0) return '1024x1536';
    return '1024x1024';
  }
  function dataUrlToBlob(u) {
    const i = u.indexOf(',');
    const meta = u.slice(0, i), b64 = u.slice(i + 1);
    const mime = (meta.split(';')[0].split(':')[1]) || 'image/png';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
    return new Blob([arr], { type: mime });
  }

  async function genByteplus(p, key, model, prompt, refs, size, fmt, optMode, cleanRender, warns) {
    const base = (p.base_url || '').replace(/\/+$/, '');
    let pr = prompt, sz = mapSeedSize(size);
    const body = { model: model, prompt: pr, size: sz, output_format: fmt, response_format: 'url', watermark: false };
    if (optMode) body.optimize_prompt_options = { mode: optMode };
    const imgs = (refs || []).filter(Boolean);
    if (imgs.length === 1) body.image = imgs[0];
    else if (imgs.length > 1) body.image = imgs;
    const r = await httpJson('POST', base + '/images/generations',
      { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }, body, 900000);
    if (r.status !== 200) throw new Error('生图失败: ' + errText(r.data));
    const out = [];
    ((r.data || {}).data || []).forEach(function (it) {
      if (it.url) out.push({ url: it.url });
      else if (it.b64_json) out.push({ b64_json: it.b64_json });
    });
    return out;
  }

  async function genOpenai(p, key, model, prompt, refs, size, fmt, quality, background, warns) {
    const base = (p.base_url || '').replace(/\/+$/, '');
    const psize = presetOpenaiSize(size);
    const imgs = (refs || []).filter(Boolean);
    const extra = {};
    if (quality) extra.quality = quality;
    if (fmt) extra.output_format = fmt;
    if (background) extra.background = background;
    if (!imgs.length) {
      const payload = Object.assign({ model: model, prompt: prompt, n: 1, response_format: 'b64_json', size: psize }, extra);
      const r = await httpJson('POST', base + '/images/generations',
        { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }, payload, 900000);
      if (r.status !== 200) throw new Error('gpt-image: ' + errText(r.data));
      return ((r.data || {}).data || []).map(function (it) { return { b64_json: it.b64_json || '' }; });
    }
    // 参考图 -> multipart
    const fd = new FormData();
    fd.append('model', model); fd.append('prompt', prompt); fd.append('n', '1');
    fd.append('response_format', 'b64_json'); fd.append('size', psize);
    Object.keys(extra).forEach(function (k) { fd.append(k, String(extra[k])); });
    const names = ['ref.png', 'ref2.png', 'ref3.png', 'ref4.png', 'ref5.png', 'ref6.png', 'ref7.png', 'ref8.png', 'ref9.png', 'ref10.png'];
    imgs.forEach(function (r, i) { fd.append('image', dataUrlToBlob(r), names[i] || ('ref' + i + '.png')); });
    const res = await http('POST', base + '/images/edits', { 'Authorization': 'Bearer ' + key }, fd, 900000);
    if (res.status !== 200) throw new Error('gpt-image 编辑: ' + errText(res.data));
    return ((res.data || {}).data || []).map(function (it) { return { b64_json: it.b64_json || '' }; });
  }

  // ---------- 存图 ----------
  const DIR = 'DOCUMENTS';
  let FILE_BASE = (function () { try { return localStorage.getItem('sw_n_filebase') || null; } catch (e) { return null; } })();
  async function fileBase() {
    if (FILE_BASE != null) return FILE_BASE;
    try {
      const r = await FS.getUri({ path: '', directory: DIR });
      FILE_BASE = String(r.uri || '').replace(/\/+$/, '');
      try { localStorage.setItem('sw_n_filebase', FILE_BASE); } catch (e) {}
    } catch (e) { FILE_BASE = ''; }
    return FILE_BASE;
  }
  async function blobDims(blob) {
    try {
      if (typeof createImageBitmap === 'function') {
        const bm = await createImageBitmap(blob);
        const w = bm.width, h = bm.height; bm.close(); return [w, h];
      }
    } catch (e) {}
    return new Promise(function (res) {
      let done = false;
      const fin = function (w, h) { if (!done) { done = true; res([w, h]); } };
      const timer = setTimeout(function () { fin(0, 0); }, 4000);   // 防卡死
      try {
        const u = URL.createObjectURL(blob); const im = new Image();
        im.onload = function () { clearTimeout(timer); const w = im.naturalWidth, h = im.naturalHeight; URL.revokeObjectURL(u); fin(w, h); };
        im.onerror = function () { clearTimeout(timer); URL.revokeObjectURL(u); fin(0, 0); };
        im.src = u;
      } catch (e) { clearTimeout(timer); fin(0, 0); }
    });
  }
  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onload = function () { const s = String(r.result || ''); res(s.slice(s.indexOf(',') + 1)); };
      r.onerror = rej; r.readAsDataURL(blob);
    });
  }
  async function saveOutputs(items, gid) {
    const saved = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      let blob = null;
      if (it.b64_json) {
        const bin = atob(it.b64_json);
        const arr = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
        blob = new Blob([arr], { type: 'image/png' });
      } else if (it.url) {
        const r = await http('GET', it.url, {}, null, 300000);
        let raw = r.raw;
        if (typeof raw === 'string') {
          // 可能是 base64 或二进制字符串, 交给 Blob 按 latin1 处理不可靠 -> 用 fetch 再取一次
          try { const rr = await fetch(it.url); blob = await rr.blob(); } catch (e) { blob = null; }
        } else if (raw instanceof Blob) { blob = raw; }
        else if (raw && raw.byteLength) { blob = new Blob([raw], { type: 'image/png' }); }
        if (!blob) throw new Error('下载图片失败');
      }
      if (!blob) continue;
      const fn = gid + '_' + i + '.png';
      const b64 = await blobToB64(blob);
      await PL('Filesystem').writeFile({ path: fn, data: b64, directory: DIR, recursive: true });
      try {
        const FSx = PL('Filesystem'), MEDIA = PL('Media');
        if (MEDIA && MEDIA.savePhoto) await MEDIA.savePhoto({ path: await FSx.getUri({ path: fn, directory: DIR }).then(function (u) { return u.uri; }) });
      } catch (e) { /* 相册失败不影响主流程 */ }
      const wh = await blobDims(blob);
      saved.push({ file: fn, mb: Math.round(blob.size / 1024 / 1024 * 100) / 100, w: wh[0], h: wh[1] });
    }
    return saved;
  }

  // ---------- 历史 ----------
  function hist() { return Sget(SK.hist, []); }
  function histSave(h) { Sset(SK.hist, h.slice(0, 500)); }
  function imgSrcOf(fn) {
    if (!FILE_BASE) return '';
    const abs = FILE_BASE + '/' + fn;
    return convertFileSrc(abs);
  }

  // ---------- 生成主流程 ----------
  async function doGenerate(body) {
    await ensureCfg();
    const provider = body.provider, im = body.image_model;
    const p = CFG[provider];
    if (!p) throw new Error('未知服务方');
    const key = keyOf(provider);
    if (!key) throw new Error('请先在设置里填写 ' + provider + ' 的 API Key');
    let final = body.prompt;
    let histOpt = null;
    if (body.optimize) {
      const o = await optimize({ provider: body.chat_provider || provider, chat_model: body.chat_model,
        prompt: body.prompt, optimize_prompt: body.optimize_prompt,
        refs: body.refs, use_vision: body.use_vision, disable_thinking: body.disable_thinking });
      final = o.optimized_prompt; histOpt = final;
    } else if (body.pre_optimized_prompt) { final = body.pre_optimized_prompt; histOpt = final; }
    // 参考图角色说明
    const refs = (body.refs || []).filter(Boolean);
    if ((body.ref_roles || []).some(function (r) { return r && r !== 'auto'; }) && refs.length >= 2) {
      const lines = [];
      (body.ref_roles || []).slice(0, refs.length).forEach(function (rl, i) { if (rl && rl !== 'auto') lines.push('Image ' + (i + 1) + ' = ' + rl); });
      if (lines.length) final = final.trim() + ' Reference image roles: ' + lines.join('; ') + '. Strictly follow these roles: use each Image ONLY for its assigned role, do not swap or merge identities/features between images.';
    }
    const warns = [];
    let items;
    if (provider === 'byteplus') {
      items = await genByteplus(p, key, im, final, refs, body.size, body.output_format || 'png', body.opt_mode, body.clean_render, warns);
    } else {
      items = await genOpenai(p, key, im, final, refs, body.size, body.output_format || 'png', body.quality, body.background, warns);
    }
    const gid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const saved = await saveOutputs(items, gid);
    const rec = {
      id: gid, ts: Math.floor(Date.now() / 1000), provider: provider, model: im,
      prompt: body.original_prompt || body.prompt, optimized_prompt: histOpt, refs: refs.length,
      size: body.size, status: 'ok', quality: body.quality, opt_mode: body.opt_mode,
      background: body.background, format: body.output_format, watermark: false,
      output: { files: saved },
      // 便于前端直接渲染
      img_mb: saved[0] && saved[0].mb, img_w: saved[0] && saved[0].w, img_h: saved[0] && saved[0].h,
      images: saved.map(function (f) { return { url: '/img/' + f.file, download: '/img/' + f.file, mb: f.mb, w: f.w, h: f.h }; }),
    };
    const h = hist(); h.unshift(rec); histSave(h);
    return { id: gid, files: saved, optimized_prompt: body.optimize ? final : null, final_prompt: final,
      warning: warns.length ? warns.join('；') : null, images: rec.images };
  }

  async function doEdit(body) {
    await ensureCfg();
    const provider = body.provider, model = body.image_model;
    const p = CFG[provider]; if (!p) throw new Error('未知服务方');
    const key = keyOf(provider); if (!key) throw new Error('请先在设置里填写 ' + provider + ' 的 API Key');
    const prompt = (body.prompt || '').trim(); if (!prompt) throw new Error('请输入要修改的内容');
    // 原图 -> dataURL
    let imgData = body.image || '';
    if (imgData.indexOf('/img/') === 0) {
      const fn = imgData.slice(5);
      const u = await PL('Filesystem').getUri({ path: fn, directory: DIR });
      const r = await fetch(convertFileSrc(u.uri)); const b = await r.blob();
      imgData = 'data:image/png;base64,' + (await blobToB64(b));
    }
    const base = (p.base_url || '').replace(/\/+$/, '');
    let items;
    if (provider === 'byteplus') {
      const sz = (body.size && seedSizeOk(body.size) && body.size !== 'auto') ? body.size : '2K';
      const box = body.box;
      let full = prompt.replace(/[。.]+$/, '');
      if (box && box.length === 4) {
        let x1 = Math.max(0, Math.min(999, Math.round(box[0]))), y1 = Math.max(0, Math.min(999, Math.round(box[1])));
        let x2 = Math.max(0, Math.min(999, Math.round(box[2]))), y2 = Math.max(0, Math.min(999, Math.round(box[3])));
        if (x2 < x1) { const t = x1; x1 = x2; x2 = t; }
        if (y2 < y1) { const t = y1; y1 = y2; y2 = t; }
        full += (x1 <= 10 && y1 <= 10 && x2 >= 989 && y2 >= 989)
          ? '. Apply this change to the entire image Image 1, while keeping the same subject and composition.'
          : '. Only modify the specified region Image 1 ' + x1 + ' ' + y1 + ' ' + x2 + ' ' + y2 + '; keep everything else in Image 1 unchanged.';
      } else {
        full += '. Only modify the area described; keep everything else unchanged.';
      }
      const r = await httpJson('POST', base + '/images/generations',
        { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        { model: model, prompt: full, size: sz, output_format: 'png', response_format: 'url', watermark: false, image: imgData }, 900000);
      if (r.status !== 200) throw new Error('局部编辑失败: ' + errText(r.data));
      items = ((r.data || {}).data || []).map(function (it) { return it.url ? { url: it.url } : { b64_json: it.b64_json }; });
    } else {
      const fd = new FormData();
      fd.append('model', model); fd.append('prompt', prompt); fd.append('n', '1');
      fd.append('response_format', 'b64_json'); fd.append('size', 'auto');
      fd.append('image', dataUrlToBlob(imgData), 'image.png');
      if (body.mask) fd.append('mask', dataUrlToBlob(body.mask), 'mask.png');
      const r = await http('POST', base + '/images/edits', { 'Authorization': 'Bearer ' + key }, fd, 900000);
      if (r.status !== 200) throw new Error('局部编辑失败: ' + errText(r.data));
      items = ((r.data || {}).data || []).map(function (it) { return { b64_json: it.b64_json || '' }; });
    }
    const gid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const saved = await saveOutputs(items, gid);
    const rec = {
      id: gid, ts: Math.floor(Date.now() / 1000), provider: provider, model: model,
      prompt: '[编辑] ' + prompt, optimized_prompt: null, refs: 1, size: body.size, status: 'ok',
      output: { files: saved },
      img_mb: saved[0] && saved[0].mb, img_w: saved[0] && saved[0].w, img_h: saved[0] && saved[0].h,
      images: saved.map(function (f) { return { url: '/img/' + f.file, download: '/img/' + f.file, mb: f.mb, w: f.w, h: f.h }; }),
    };
    const h = hist(); h.unshift(rec); histSave(h);
    return { id: gid, files: saved, images: rec.images, final_prompt: prompt };
  }

  // ---------- 其他端点 ----------
  /** 取 API Key: 显式传入优先, 否则用已保存的; 都没有就给详细报错, 便于定位 */
  function pickKey(body) {
    const prov = (body && body.provider) || '';
    const explicit = (body && body.api_key || '').trim();
    if (explicit) return explicit;
    const saved = keyOf(prov);
    if (saved) return saved;
    // 兜底: 同 base_url 的其它 provider 上有 Key 也能用(常见于"新增提供方"重复配置)
    try {
      const url = String(body && body.base_url || '').replace(/\/+$/, '');
      const all = K();
      if (url) {
        for (const pk of Object.keys(CFG || {})) {
          if (pk === prov) continue;
          const pu = String((CFG[pk] || {}).base_url || '').replace(/\/+$/, '');
          if (pu && pu === url && all[pk]) return all[pk];
        }
      }
    } catch (e) {}
    const have = Object.keys(K());
    throw new Error('未找到「' + prov + '」的 API Key'
      + (have.length ? '（已保存的：' + have.join('、') + '）' : '（还没保存过任何 Key —— 请先填好 Key 再点「保存」）'));
  }

  async function detect(body) {
    await ensureCfg();
    const base = (body.base_url || (CFG[body.provider] || {}).base_url || '').replace(/\/+$/, '');
    if (!base) throw new Error('缺少 Base URL');
    const key = pickKey(body);
    const r = await httpJson('GET', base + '/models', { 'Authorization': 'Bearer ' + key }, null, 60000);
    if (r.status !== 200) {
      return { models: [], unsupported: true, message: '未能列出模型(HTTP ' + r.status + ')：' + errText(r.data) + '。该接口可能未开放列模型；生图 Key 若可用，请点「诊断」验证，或点「手动」添加模型。' };
    }
    const ids = ((r.data || {}).data || []).map(function (m) { return m.id; }).filter(Boolean);
    return { models: ids, unsupported: false, message: '检测到 ' + ids.length + ' 个模型' };
  }
  async function testConn(body) {
    await ensureCfg();
    const base = (body.base_url || (CFG[body.provider] || {}).base_url || '').replace(/\/+$/, '');
    if (!base) throw new Error('缺少 Base URL');
    const key = pickKey(body);
    const lines = [];
    const fp = key ? (key.slice(0, 6) + '…' + key.slice(-4) + '（长度 ' + key.length + '）') : '(无)';
    lines.push('Base URL: ' + base);
    lines.push('Key 指纹: ' + fp);

    // ① 列模型
    let r1 = await httpJson('GET', base + '/models', { 'Authorization': 'Bearer ' + key }, null, 60000);
    if (r1.status === 200) {
      const n = (((r1.data || {}).data) || []).length;
      lines.push('① 列模型: HTTP 200 · ' + n + ' 个 ✅');
    } else {
      lines.push('① 列模型: HTTP ' + r1.status + ' · ' + errText(r1.data));
    }

    // ② 对话测试(用该服务方第一个对话模型)
    const cm = body.model || (((CFG[body.provider] || {}).chat_models || [])[0] || {}).id;
    let chatOk = false;
    if (cm) {
      lines.push('② 对话模型: ' + cm);
      const payload = { model: cm, messages: [{ role: 'user', content: 'hi' }] };
      const r2 = await httpJson('POST', base + '/chat/completions',
        { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }, payload, 60000);
      if (r2.status === 200) {
        chatOk = true;
        lines.push('   结果: HTTP 200 · 可调用 ✅');
      } else {
        lines.push('   结果: HTTP ' + r2.status + ' · ' + errText(r2.data).slice(0, 200));
        lines.push('   请求体: ' + JSON.stringify(payload));
        lines.push('   请求头: Authorization: Bearer ' + fp + ' / Content-Type: application/json');
      }
    } else {
      lines.push('② 对话模型: (该服务方未配置文本模型)');
    }

    const ok = r1.status === 200 && (!cm || chatOk);
    return { ok: ok, status: r1.status, message: lines.join('\n'), model_count: 0 };
  }
  async function netdiag(body) {
    const out = [], mb = Math.max(1, Math.min(20, (body && body.mb) || 5));
    const t0 = Date.now();
    try {
      const r = await http('GET', 'https://speed.cloudflare.com/__down?bytes=1024', {}, null, 20000);
      out.push({ name: '小请求 (TLS 握手)', ok: r.status === 200, ms: Date.now() - t0, detail: 'HTTP ' + r.status });
    } catch (e) { out.push({ name: '小请求 (TLS 握手)', ok: false, ms: Date.now() - t0, detail: String(e.message || e).slice(0, 160) }); }
    const t1 = Date.now();
    try {
      const r = await http('GET', 'https://speed.cloudflare.com/__down?bytes=' + mb * 1024 * 1024, {}, null, 180000);
      const len = (typeof r.raw === 'string') ? r.raw.length : ((r.raw && r.raw.byteLength) || 0);
      out.push({ name: '大下载 ' + mb + ' MB', ok: len >= mb * 1024 * 1024 * 0.9, ms: Date.now() - t1, detail: '收到 ' + (len / 1024 / 1024).toFixed(1) + ' MB' });
    } catch (e) { out.push({ name: '大下载 ' + mb + ' MB', ok: false, ms: Date.now() - t1, detail: String(e.message || e).slice(0, 200) }); }
    return { tests: out, advice: out.every(function (t) { return t.ok; }) ? '网络正常。' : '有项目失败，可能是网络/代理问题。' };
  }
  async function bgtest(body) {
    await ensureCfg();
    const p = CFG[body.provider]; if (!p) throw new Error('未知服务方');
    const key = keyOf(body.provider); if (!key) throw new Error('请先在设置里填写 ' + body.provider + ' 的 API Key');
    const base = (p.base_url || '').replace(/\/+$/, '');
    const models = (p.image_models || []).map(function (m) { return m.id; });
    const rows = [];
    for (const m of models) {
      const one = { model: m };
      for (const [k, ref] of [['text2img', null], ['img2img', true]]) {
        try {
          const body2 = { model: m, prompt: 'a single red circle centered on a plain background, isolated subject', n: 1,
            size: '1024x1024', quality: 'low', output_format: 'png', response_format: 'b64_json', background: 'transparent' };
          let r;
          if (ref) {
            const fd = new FormData();
            Object.keys(body2).forEach(function (kk) { fd.append(kk, String(body2[kk])); });
            fd.append('image', dataUrlToBlob(tinyPng()), 'ref.png');
            r = await http('POST', base + '/images/edits', { 'Authorization': 'Bearer ' + key }, fd, 300000);
          } else {
            r = await httpJson('POST', base + '/images/generations', { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }, body2, 300000);
          }
          if (r.status !== 200) { one[k] = { ok: false, error: errText(r.data), verdict: '不支持' }; continue; }
          const it = ((r.data || {}).data || [])[0] || {};
          const info = it.b64_json ? await pngAlpha(it.b64_json) : null;
          one[k] = { ok: true, info: info, verdict: !info ? '无数据' : (!info.alpha_channel ? '参数被忽略(返回无透明通道)' : (info.transparent > 0 ? '支持' : '有通道但无透明像素')) };
        } catch (e) { one[k] = { ok: false, error: String(e.message || e).slice(0, 200), verdict: '不支持' }; }
      }
      rows.push(one);
    }
    const cnt = function (k) { return rows.filter(function (r) { return r[k] && r[k].verdict === '支持'; }).length; };
    return { rows: rows, summary: { total: rows.length, text2img_ok: cnt('text2img'), img2img_ok: cnt('img2img') } };
  }
  function tinyPng() {
    // 64x64 纯色 PNG (手工构造, 避免依赖 canvas)
    const w = 64, h = 64;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d'); cx.fillStyle = 'rgb(200,80,80)'; cx.fillRect(0, 0, w, h);
    return cv.toDataURL('image/png');
  }
  async function pngAlpha(b64) {
    try {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const bm = await createImageBitmap(new Blob([arr], { type: 'image/png' }));
      const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height;
      const cx = cv.getContext('2d'); cx.drawImage(bm, 0, 0);
      const d = cx.getImageData(0, 0, bm.width, bm.height).data;
      let t = 0, n = 0;
      for (let i = 3; i < d.length; i += 4 * 16) { n++; if (d[i] === 0) t++; }
      bm.close();
      return { w: cv.width, h: cv.height, alpha_channel: true, sampled: n, transparent: t, checked: true };
    } catch (e) { return null; }
  }

  // ---------- 本机任务(无需服务器, 内存里跑) ----------
  const JOBS = {};
  function startJob(kind, fn) {
    const id = 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    JOBS[id] = { _status: 'running' };
    fn().then(function (r) {
      r._status = 'done'; JOBS[id] = r;
      try {
        const n = (r.images || []).length; const px = (r.images || [])[0] || {};
        window.sysNotify && window.sysNotify('Seedream ' + (kind === 'edit' ? '编辑' : '生成') + '完成',
          n + ' 张' + (px.w ? ' · ' + px.w + '×' + px.h : ''));
      } catch (e) {}
    }).catch(function (e) {
      const msg = String(e && e.message || e).slice(0, 300);
      JOBS[id] = { _status: 'failed', error: msg };
      try { window.sysNotify && window.sysNotify('Seedream ' + (kind === 'edit' ? '编辑' : '生成') + '失败', msg.slice(0, 140)); } catch (e2) {}
    });
    return { task_id: id };
  }

  // ---------- 路由 ----------
  async function handle(method, path, body) {
    if (!isNative()) return undefined;   // 网页版不接管
    const P = String(path || '').split('?')[0];
    const qs = {};
    String(path || '').split('?')[1] && String(path).split('?')[1].split('&').forEach(function (kv) {
      const i = kv.indexOf('='); if (i > 0) qs[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    try {
      if (P === '/api/health') return { ok: true, time: new Date().toTimeString().slice(0, 8) };
      if (P === '/api/models') { await ensureCfg(); const o = {}; Object.keys(CFG).forEach(function (k) { const p = CFG[k]; o[k] = { label: p.label || k, image_models: p.image_models || [], chat_models: p.chat_models || [] }; }); return o; }
      if (P === '/api/config') {
        if (method === 'GET') { await ensureCfg(); return CFG; }
        if (method === 'PUT') { CFG = body; Sset(SK.cfg, CFG); return { ok: true }; }
      }
      if (P === '/api/prefs') {
        if (method === 'GET') return Sget(SK.prefs, {});
        if (method === 'PUT') { Sset(SK.prefs, body); return { ok: true }; }
      }
      if (P === '/api/settings') {
        if (method === 'GET') { const k = K(), o = {}; Object.keys(k).forEach(function (p) { o[p] = { has_key: !!k[p] }; }); return { providers: o }; }
        if (method === 'POST') { const ks = body.keys || {}; Object.keys(ks).forEach(function (p) { setKey(p, ks[p]); }); return { ok: true }; }
      }
      if (P === '/api/key') { if (method === 'GET') return { key: keyOf(qs.provider || '') }; }
      if (P === '/api/history' && method === 'GET') return hist();
      if (P.indexOf('/api/history/') === 0 && method === 'DELETE') {
        const id = P.slice('/api/history/'.length);
        const h = hist(); const rec = h.filter(function (x) { return x.id === id; })[0];
        if (rec) { for (const f of ((rec.output || {}).files || [])) { try { await FS.deleteFile({ path: f.file, directory: DIR }); } catch (e) {} } }
        histSave(h.filter(function (x) { return x.id !== id; }));
        return { ok: true, deleted: rec ? 1 : 0 };
      }
      if (P === '/api/history/batch' && method === 'POST') {
        const ids = body.ids || []; let n = 0;
        for (const id of ids) { const r = await handle('DELETE', '/api/history/' + id, null); n += (r.deleted || 0); }
        return { ok: true, deleted: n };
      }
      if (P === '/api/tasks') {
        const running = Object.keys(JOBS).filter(function (k) { return JOBS[k]._status === 'running'; })
          .map(function (k) { return { id: k, model: '', status: 'running' }; });
        return { running: running };
      }
      if (P === '/api/optimize') return await optimize(body);
      if (P === '/api/describe') return await describe(body);
      if (P === '/api/detect') return await detect(body);
      if (P === '/api/test') return await testConn(body);
      if (P === '/api/netdiag') return await netdiag(body);
      if (P === '/api/bgtest') return await bgtest(body);
      // 生成/编辑: 后台跑, 立刻返回 task_id (与网关行为一致, 前端可显示进度)
      if (P === '/api/generate') return startJob('gen', function () { return doGenerate(body); });
      if (P === '/api/edit') return startJob('edit', function () { return doEdit(body); });
      if (P.indexOf('/api/task/') === 0) {
        const id = P.slice('/api/task/'.length);
        const j = JOBS[id];
        if (!j) return { _status: 'failed', error: '任务不存在（App 可能被重启过）' };
        return j;
      }
      return undefined;   // 未处理 -> 交回原有网络逻辑
    } catch (e) {
      if (P === '/api/generate' || P === '/api/edit') return { _status: 'failed', error: String(e && e.message || e).slice(0, 300) };
      throw e;
    }
  }

  window.NATIVE_API = {
    handle: handle,
    imgSrcOf: imgSrcOf,
    ensureCfg: ensureCfg,
    fileBase: fileBase,
    isNative: isNative,
  };
})();
