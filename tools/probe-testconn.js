// 在 App WebView 里跑「诊断」, 目标指向 mock 服务器 (10.0.2.2 = 模拟器看宿主机)
// 会依次触发: ① GET /models  ② POST /chat/completions —— 全走 CapacitorHttp
window.NATIVE_API.handle('POST', '/api/test', {
  provider: 'mock',
  base_url: 'http://10.0.2.2:8642',
  api_key: 'sk-mockkey-0123456789',
  model: 'deepseek-v4-1-flash-260910',
})
