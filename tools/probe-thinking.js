// 探针: 验证 thinking:disabled 的保留/放弃策略
// 场景A(/thka): 服务端拒 temperature -> 降级后仍应带 thinking
// 场景B(/thkb): 服务端拒 thinking(错误提及) -> 才去掉 thinking 重试
(async () => {
  const out = {};
  try { localStorage.setItem('sw_n_keys', JSON.stringify({ mock: 'sk-mockkey-0123456789' })); } catch (e) {}
  const setMock = async (base) => {
    const cfg = await window.NATIVE_API.handle('GET', '/api/config', null);
    cfg.mock = { label: 'mock', base_url: base, image_models: [], chat_models: [] };
    await window.NATIVE_API.handle('PUT', '/api/config', cfg);
    return cfg;
  };
  const run = () => window.NATIVE_API.handle('POST', '/api/optimize',
    { provider: 'mock', chat_model: 'deepseek-x', prompt: 'a cat', disable_thinking: true });

  // 场景 A
  await setMock('http://10.0.2.2:8642/thka');
  const a = await run().catch(e => ({ err: String(e) }));
  out.A = { ok: !!a.optimized_prompt, err: a.err || null };

  // 场景 B
  await setMock('http://10.0.2.2:8642/thkb');
  const b = await run().catch(e => ({ err: String(e) }));
  out.B = { ok: !!b.optimized_prompt, err: b.err || null };
  return JSON.stringify(out, null, 1);
})()
