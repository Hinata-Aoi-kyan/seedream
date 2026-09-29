// 探针 B: 指向 /waf 前缀 —— mock 会对「无 Origin 的原生请求」返 403,
// 触发 App 的 403 自动回退(WebView fetch 带 Origin -> 应放行 200)
window.NATIVE_API.handle('POST', '/api/test', {
  provider: 'mock',
  base_url: 'http://10.0.2.2:8642/waf',
  api_key: 'sk-mockkey-0123456789',
  model: 'deepseek-v4-1-flash-260910',
})
