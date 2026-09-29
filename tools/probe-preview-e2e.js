// 端到端验证: 用真实文件(经 Filesystem 写盘, 如 saveOutputs)驱动预览/记录/保存
(async () => {
  const FS = window.Capacitor.Plugins.Filesystem;
  const out = {};
  // 1x1 PNG 与 300x400 渐变图都行, 但要用真实文件名走 /img/ 路径
  // 先画一张 300x400 的图存成文件(模拟真实生成产物)
  const cv = document.createElement('canvas'); cv.width = 300; cv.height = 400;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 300, 400); g.addColorStop(0, '#4c8dff'); g.addColorStop(1, '#7a5cff');
  x.fillStyle = g; x.fillRect(0, 0, 300, 400);
  x.fillStyle = 'rgba(255,255,255,.92)'; x.beginPath(); x.arc(150, 170, 70, 0, 7); x.fill();
  x.fillStyle = '#0c0e13'; x.font = 'bold 24px sans-serif'; x.textAlign = 'center'; x.fillText('REAL FILE', 150, 320);
  const b64 = cv.toDataURL('image/png').split(',')[1];
  const fname = 'realprobe_0.png';
  await FS.writeFile({ path: fname, data: b64, directory: 'DOCUMENTS', recursive: true });
  out.wrote = fname;

  // 2) imgSrcOf 是否产出可加载地址
  out.imgSrcOf = window.NATIVE_API.imgSrcOf(fname);
  out.imgLoads = await new Promise(res => {
    const i = new Image();
    i.onload = () => res('OK ' + i.naturalWidth + 'x' + i.naturalHeight);
    i.onerror = () => res('FAIL');
    i.src = out.imgSrcOf;
    setTimeout(() => res('TIMEOUT'), 5000);
  });

  // 3) 注入记录 → 渲染记录网格, 数有几张 img 是自然尺寸>0(即没裂)
  const rec = { id: 'realtest1', ts: Math.floor(Date.now() / 1000), provider: 'byteplus', model: 'seedream-5-0',
    prompt: 'real file preview check', refs: 0, size: '1.5K', status: 'ok', output: { files: [{ file: fname }] },
    img_mb: 0.05, img_w: 300, img_h: 400,
    images: [{ url: '/img/' + fname, download: '/img/' + fname, mb: 0.05, w: 300, h: 400 }] };
  const h = JSON.parse(localStorage.getItem('sw_n_hist') || '[]'); h.unshift(rec);
  localStorage.setItem('sw_n_hist', JSON.stringify(h));
  await loadHistory();
  out.historyImgs = [...document.querySelectorAll('#history .hitem img')].map(i => (i.naturalWidth > 0 ? 'OK' : 'BROKEN'));

  // 4) 生成结果区渲染同一张图
  renderResults(document.getElementById('results'), { images: rec.images }, { provider: 'byteplus', model: 'seedream-5-0' });
  out.resultImgs = [...document.querySelectorAll('#results .res img')].map(i => (i.naturalWidth > 0 ? 'OK' : 'BROKEN'));

  // 5) 保存入口(saveImageFile 走 Filesystem 读, 不再 fetch /img/)
  try { await saveImageFile('/img/' + fname, 'seedream-probe.png'); out.save = 'no-throw'; }
  catch (e) { out.save = 'THREW ' + e; }

  return JSON.stringify(out, null, 1);
})()
