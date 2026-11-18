const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadCloud}=require('../tools/load-cloud.cjs');
const clock=s=>Date.parse('2026-11-18T'+s+':00+08:00');
const previous='17/11/2026 18:30',before='17/11/2026 09:00';
const form=(code,time,title)=>({relTime:time,title,stock:[{sc:code}],webPath:'/listedco/listconews/sehk/2026/1117/'+code+'_'+time.slice(-2)+'_c.pdf'});
function setup(){
  let action,current=clock('09:00');const files=new Map();
  const ctx=loadCloud(['WarrenCore','WarrenNews'], {Date:class extends Date {static now(){return current;}},UrlFetchApp:{fetch:url=>({getResponseCode:()=>200,getContentText:()=>url.includes('globalxetfs')?action(url):JSON.stringify(action(url))})}});
  const response=url=>{
    if(url.includes('globalxetfs')){
      const code=url.includes('hscei')?'3416':'3417';
      return '<a href="https://investments.miraeasset.com.hk/docs/notices/c'+code+'-Dividend_20261117.pdf">2026年11月17日 - 分派公告（仅限上市类别股份）</a>';
    }
    if(url.includes('hkma.gov.hk'))return {header:{success:true},result:{records:[{date:'2026-11-18',title:'同日无时刻的金管局公告',link:'https://www.hkma.gov.hk/gb_chi/example/'}]}};
    const head=url.endsWith('_1.json');
    const rows=head?[form('03417','18/11/2026 09:16','截止后发布'),form('09999',previous,'非观察池')]:
      [form('03877',previous,'关联交易 <条款>'),form('03417',previous,'ETF分派'),form('03877',before,'已过窗口')];
    return {genDate:clock('09:00'),maxNumOfFile:2,newsInfoLst:rows};
  };
  action=response;
  return {news:ctx.WarrenNews,response,setTime:t=>current=t,setFetch:f=>action=f,read:(k,d)=>files.get(k)??d,write:(k,v)=>files.set(k,v)};
}
test('filters real release times and symbols across pages and leaves undated-intraday HKMA items out of late lookback',()=>{
  const c=setup(),s=c.news.collect(clock('09:31'),null,c.response);
  assert.ok(s.sources.every(x=>x.ok));assert.deepEqual(Array.from(s.sources[0].items,x=>x.title),['关联交易 <条款>','ETF分派']);
  assert.equal(s.sources[1].items.length,0);
  assert.match(s.sources[2].items[0].url,/3416/);assert.match(s.sources[3].items[0].url,/3417/);
  const pending=c.news.attach({text:'待补',html:'<table></table>'},clock('09:32'),()=>s);
  assert.match(pending.html,/3417-Dividend/);
});
test('unreadable, empty and shifting listings cannot be reported as a successful no-change check',()=>{
  for(const bad of [()=>null,()=>({genDate:clock('09:00'),maxNumOfFile:1,newsInfoLst:[]}),url=>{
    const c=setup(),p=c.response(url);if(url.endsWith('_2.json'))p.genDate+=1000;return p;
  }]){
    const c=setup(),s=c.news.collect(clock('09:31'),null,url=>url.includes('hkma')?c.response(url):bad(url));
    assert.equal(s.sources[0].ok,false);assert.equal(s.sources[1].ok,true);
    const mail=c.news.attach({text:'市场：待核\n较上版：待核',html:'<p><br><b>较上版</b></p>'},clock('09:32'),()=>s);
    assert.match(mail.text,/披露易未完成核验/);assert.doesNotMatch(mail.html,/披露易[^。<]{0,40}未见相关公告/);
  }
});
test('failure at cutoff retains the earlier actual check and a later retry recovers without backdating',()=>{
  const c=setup(),key='2026-11-18-morning-sources.json';
  c.setTime(clock('09:12'));c.news.refresh(clock('09:12'),null,c.read,c.write);
  c.setFetch(url=>{if(url.includes('hkexnews'))throw Error('unavailable');return c.response(url);});
  c.setTime(clock('09:15'));c.news.refresh(clock('09:15'),null,c.read,c.write);
  const kept=c.read(key);assert.match(kept.sources[0].checkedAt,/01:12/);
  const render=s=>c.news.attach({text:'市场：待核\n较上版：待核',html:'<body><br><b>较上版</b></body>'},clock('09:31'),()=>s);
  assert.match(render(kept).text,/09:12核验（后续重查失败）/);
  c.setFetch(c.response);c.setTime(clock('09:21'));c.news.refresh(clock('09:21'),null,c.read,c.write);
  const s=c.read(key);assert.equal(s.sources[0].lastFailureAt,undefined);
  assert.match(s.sources[0].checkedAt,/01:21/);assert.match(s.cutoff,/01:15/);
  assert.equal(s.sources[1].items.length,1);assert.doesNotMatch(render(s).html,/<条款>/);
  assert.doesNotMatch(render({...s,day:'2026-11-17'}).text,/关联交易|ETF分派/);
});
test('a date-only notice first observed after 09:15 cannot enter the 09:15 brief even if the request began earlier',()=>{
  const c=setup(),s=c.news.collect(clock('09:14'),null,c.response,()=>clock('09:16'));
  assert.equal(s.sources[1].items.length,0);
  assert.match(s.sources[1].checkedAt,/01:16/);
  assert.deepEqual(Array.from(s.sources[2].items,x=>x.publishedAt),['2026-11-17']);
});
test('an unexpected fund page fails just that issuer and a corrupt local snapshot is rebuilt',()=>{
  const c=setup();
  c.setFetch(url=>url.includes('/hscei-covered')?'<html>Maintenance</html>':c.response(url));
  c.setTime(clock('09:12'));c.news.refresh(clock('09:12'),null,()=>{throw Error('invalid JSON');},c.write);
  const s=c.read('2026-11-18-morning-sources.json');
  assert.equal(s.sources[2].ok,false);assert.equal(s.sources[3].ok,true);
  const rendered=c.news.attach({text:'正文',html:'<body>正文</body>'},clock('09:14'),()=>s);
  assert.match(rendered.text,/03416分派未完成核验/);assert.match(rendered.html,/3417-Dividend/);
});
