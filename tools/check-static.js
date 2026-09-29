// 静态检查(HANDOFF §6 思路):
// 1) 反引号模板里误用 '+icon(' 拼接语法(四态状态机)
// 2) CSS 每条规则内同一属性只出现一次(防 padding 简写覆盖安全区之类)
const fs = require('fs');
const html = fs.readFileSync(process.argv[2] || 'index.html', 'utf8');
let state = 'code', bad = [];
for (let i = 0; i < html.length; i++) {
  const c = html[i], p = html[i - 1];
  if (state === 'code') {
    if (c === "'" && p !== '\\') state = 'sq';
    else if (c === '"' && p !== '\\') state = 'dq';
    else if (c === '`') state = 'tpl';
  } else if (state === 'sq') { if (c === "'" && p !== '\\') state = 'code'; }
  else if (state === 'dq') { if (c === '"' && p !== '\\') state = 'code'; }
  else if (state === 'tpl') { if (c === '`' && p !== '\\') state = 'code'; }
  if (state === 'tpl' && html.startsWith("' + icon(", i)) bad.push("模板里误用拼接 @offset " + i + ": " + html.slice(i - 20, i + 30).replace(/\n/g, ' '));
  if (state === 'tpl' && html.startsWith("'+icon(", i)) bad.push("模板里误用拼接 @offset " + i);
}
console.log('模板误用:', bad.length ? bad : '无');
const css = html.split('<style>')[1].split('</style>')[0];
const issues = [];
css.split('}').forEach(rule => {
  const sel = rule.split('{')[0].trim(); if (!sel || sel.includes('@')) return;
  const body = rule.split('{')[1] || '';
  const seen = {};
  body.split(';').forEach(d => {
    const m = d.trim().match(/^([a-zA-Z-]+)\s*:/); if (!m) return;
    const k = m[1].toLowerCase();
    if (seen[k]) issues.push(sel + ' 重复声明 ' + k);
    seen[k] = 1;
  });
});
console.log('CSS重复属性:', issues.length ? issues : '无');
process.exit(bad.length || issues.length ? 1 : 0);
