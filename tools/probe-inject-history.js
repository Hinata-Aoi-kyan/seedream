// 注入一条假历史记录(画布现画 300x400 渐变图), 用于 UI 验收: 记录网格/查看器/编辑器
(function(){
  const cv=document.createElement('canvas'); cv.width=300; cv.height=400;
  const x=cv.getContext('2d');
  const g=x.createLinearGradient(0,0,300,400); g.addColorStop(0,'#4c8dff'); g.addColorStop(1,'#7a5cff');
  x.fillStyle=g; x.fillRect(0,0,300,400);
  x.fillStyle='rgba(255,255,255,.92)'; x.beginPath(); x.arc(150,170,70,0,7); x.fill();
  x.fillStyle='#0c0e13'; x.font='bold 24px sans-serif'; x.textAlign='center'; x.fillText('Seedream',150,320);
  const url=cv.toDataURL('image/png');
  const rec={id:'uitest1',ts:Math.floor(Date.now()/1000),provider:'byteplus',model:'seedream-5-0',
    prompt:'a demo picture for UI check',optimized_prompt:null,refs:0,size:'1.5K',status:'ok',
    output:{files:[]},img_mb:0.05,img_w:300,img_h:400,
    images:[{url:url,download:url,mb:0.05,w:300,h:400}]};
  const h=JSON.parse(localStorage.getItem('sw_n_hist')||'[]'); h.unshift(rec);
  localStorage.setItem('sw_n_hist',JSON.stringify(h));
  switchTab('history',true); loadHistory(); return 'injected';
})()
