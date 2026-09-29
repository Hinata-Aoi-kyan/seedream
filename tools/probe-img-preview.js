// 探针: 复刻 saveOutputs 的真实文件写入 + 预览链路 (data:URL 假图测不到这条路径)
(async () => {
  const FS = window.Capacitor.Plugins.Filesystem;
  const out = {};
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const testLoad = (src) => new Promise(res => {
    if (!src) return res('SRC-EMPTY');
    const i = new Image();
    i.onload = () => res('IMG-OK ' + i.naturalWidth + 'x' + i.naturalHeight);
    i.onerror = () => res('IMG-FAIL');
    i.src = src;
    setTimeout(() => res('IMG-TIMEOUT'), 5000);
  });

  // 1) 旧代码缓存的 FILE_BASE(localStorage) —— 覆盖安装不清除, 可能是陈旧值
  out.sw_n_filebase = localStorage.getItem('sw_n_filebase');

  for (const dir of ['DOCUMENTS', 'DATA']) {
    const r = {};
    try {
      await FS.writeFile({ path: 'sdr-probe.png', data: pngB64, directory: dir, recursive: true });
      r.write = 'ok';
    } catch (e) { r.write = 'ERR ' + e; out[dir] = r; continue; }
    try {
      const gu0 = await FS.getUri({ path: '', directory: dir });
      const gu1 = await FS.getUri({ path: 'sdr-probe.png', directory: dir });
      r.uriDir = gu0.uri;
      r.uriFile = gu1.uri;
      r.convertDir = window.Capacitor.convertFileSrc(gu0.uri.replace(/\/+$/, '') + '/sdr-probe.png');
      r.convertFile = window.Capacitor.convertFileSrc(gu1.uri);
      r.loadConverted = await testLoad(r.convertFile);
    } catch (e) { r.uriErr = String(e); }
    try {
      const rd = await FS.readFile({ path: 'sdr-probe.png', directory: dir, encoding: 'base64' });
      r.readB64Len = String(rd.data).length;
      r.loadDataUrl = await testLoad('data:image/png;base64,' + rd.data);
    } catch (e) { r.readErr = String(e); }
    out[dir] = r;
  }

  // 2) 当前 imgSrcOf 实际产出 + fetch('/img/') 行为(保存按钮走的路径)
  out.imgSrcOf = window.NATIVE_API.imgSrcOf('sdr-probe.png');
  out.loadImgSrcOf = await testLoad(out.imgSrcOf);
  try {
    const resp = await fetch('/img/sdr-probe.png');
    out.fetchImgStatus = resp.status + ' ' + (resp.headers.get('content-type') || '') + ' len=' + (await resp.blob()).size;
  } catch (e) { out.fetchImgErr = String(e); }

  return JSON.stringify(out, null, 1);
})()
