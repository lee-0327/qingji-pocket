import{formatMoney}from'./core.js';
import{buildSpendingPeriods}from'./spending.js';

const PAGE_SIZE=20;
const shortDate=value=>`${Number(value.slice(5,7))}/${Number(value.slice(8,10))}`;
const fullDate=value=>`${value.slice(0,4)}.${value.slice(5,7)}.${value.slice(8,10)}`;
const rangeText=(start,end)=>start===end?fullDate(start):`${fullDate(start)} — ${fullDate(end)}`;
function chartAmount(cents){
 const amount=cents/100,trim=value=>value.includes('.')?value.replace(/0+$/,'').replace(/\.$/,''):value;
 if(amount<10000)return trim(amount.toFixed(2));
 const [unit,suffix]=amount>=999950000000?[1e12,'万亿']:amount>=99995000?[1e8,'亿']:[1e4,'万'],value=amount/unit;
 return trim(value.toFixed(value<10?2:value<100?1:0))+suffix;
}
function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;}

/** A local, read-only view of confirmed spending. The parent owns ledger edits
 * and supplies its existing escaped record-row renderer. No network or storage. */
export function createSpendingUI({host,renderRecord}){
 if(!host||typeof renderRecord!=='function')throw new TypeError('支出趋势缺少显示入口');
 let mode='week',selectedKey='',anchorMonth='',input=null,periods=[],detailLimit=PAGE_SIZE;
 const $=id=>host.querySelector('#'+id);
 host.innerHTML=`<div class="spend-heading"><div><p class="spend-eyebrow">每一笔，慢慢看清</p><h2 id="spend-title">支出趋势</h2></div><div class="spend-modes" role="group" aria-label="支出统计周期"><button id="spend-mode-week" type="button" data-spend-mode="week" aria-pressed="true" disabled>每周</button><button id="spend-mode-month" type="button" data-spend-mode="month" aria-pressed="false" disabled>每月</button></div></div>
  <p id="spend-state" class="spend-state" role="status">正在读取本机支出…</p>
  <div id="spend-content" hidden>
   <div class="spend-overview" aria-live="polite" aria-atomic="true"><div class="spend-overview-heading"><span id="spend-period-name"></span><span id="spend-count" class="spend-count"></span></div><strong id="spend-total" class="spend-total">¥0.00</strong><p id="spend-range" class="spend-range"></p><p class="spend-method">仅统计已确认支出，不抵扣退款；收入、转账、待核对和未来日期不计入。</p><p id="spend-comparison" class="spend-comparison"></p><p id="spend-baseline" class="spend-baseline"></p></div>
   <div class="spend-chart-heading"><span id="spend-chart-label"></span><span>点柱子看流水</span></div>
   <div id="spend-chart-scroll" class="spend-chart-scroll"><div id="spend-chart" class="spend-chart" role="group" aria-label="支出柱状图"></div></div>
   <p id="spend-window" class="spend-window"></p>
   <div class="spend-details"><div class="spend-detail-heading"><h3 id="spend-detail-title">支出流水</h3><span id="spend-detail-count"></span></div><p id="spend-detail-empty" class="spend-detail-empty" hidden></p><div id="spend-detail-list"></div><button id="spend-more" type="button" class="text-button spend-more" hidden>再显示 20 笔</button></div>
  </div>`;
 host.setAttribute('aria-labelledby','spend-title');

 function selected(){return periods.find(period=>period.key===selectedKey)||periods.at(-1);}
 function focusToken(){const active=document.activeElement;if(!host.contains(active))return null;if(active.dataset?.spendKey)return{key:active.dataset.spendKey};if(active.id==='spend-mode-week'||active.id==='spend-mode-month'||active.id==='spend-more')return{id:active.id};return null;}
 function restoreFocus(token){if(!token)return;const target=token.id?$(token.id):Array.from(host.querySelectorAll('[data-spend-key]')).find(button=>button.dataset.spendKey===token.key);if(target&&!target.hidden&&!target.disabled)target.focus({preventScroll:true});}
 function periodName(period){if(period.isCurrent)return mode==='week'?'本周支出':'本月支出';return mode==='week'?'这周支出':`${Number(period.start.slice(5,7))} 月支出`;}
 function comparison(period){
  const data=period.comparison,name=mode==='week'?'上周':'上月',target=$('spend-comparison');target.dataset.kind=data.kind;
  if(period.isFuture){target.textContent='尚未开始，暂不比较';$('spend-baseline').textContent='未来日期的记录不会提前计入。';return;}
  const label=data.partial?`${name}同期`:`${name}`;
  const delta=Math.abs(data.deltaCents),percentage=Number.isFinite(data.percent)?`${Math.abs(data.percent).toFixed(1)}%`:'';
  target.textContent=data.kind==='flat'?`较${label}持平`:data.kind==='new'?`${label}为 ¥0.00，增加 ${formatMoney(delta)}`:`较${label}${data.deltaCents>0?'增加':'减少'} ${formatMoney(delta)}${percentage?` · ${percentage}`:''}`;
  $('spend-baseline').textContent=`${label} ${rangeText(data.start,data.end)} · 支出 ${formatMoney(data.expenseCents)}`;
 }
 function drawSummary(){
  const period=selected();if(!period)return;
  $('spend-period-name').textContent=periodName(period);$('spend-total').textContent=formatMoney(period.expenseCents);$('spend-count').textContent=`${period.count} 笔支出`;
  $('spend-range').textContent=rangeText(period.start,period.end)+(period.isFuture?' · 尚未开始':period.comparison.partial?` · 截至 ${shortDate(period.effectiveEnd)}`:'');
  comparison(period);
 }
 function drawChart(){
  const chart=$('spend-chart'),scroll=$('spend-chart-scroll'),left=scroll.scrollLeft,max=Math.max(1,...periods.map(period=>period.expenseCents));chart.replaceChildren();
  chart.setAttribute('aria-label',`最近 ${periods.length} ${mode==='week'?'周':'个月'}支出，点击查看对应流水`);
  for(const period of periods){
   const button=node('button','spend-bar-button');button.type='button';button.dataset.spendKey=period.key;button.setAttribute('aria-pressed',String(period.key===selectedKey));button.setAttribute('aria-label',`${rangeText(period.start,period.end)}，支出 ${formatMoney(period.expenseCents)}，${period.count} 笔${period.comparison.partial?'，截至今天':''}${period.isFuture?'，尚未开始':''}，查看流水`);
   const amountText=chartAmount(period.expenseCents),amount=node('span','spend-bar-amount',amountText);if(amountText.length>6||amountText.includes('万亿'))amount.dataset.long='true';
   const track=node('span','spend-bar-track'),fill=node('span','spend-bar-fill');track.setAttribute('aria-hidden','true');fill.style.height=`${period.expenseCents/max*100}%`;track.append(fill);
   const dates=node('span','spend-bar-dates');dates.append(node('span','',mode==='month'?`${Number(period.start.slice(5,7))} 月`:shortDate(period.start)),node('small','',mode==='month'?period.start.slice(0,4):`— ${shortDate(period.end)}`));
   const state=node('span','spend-bar-state',period.key===selectedKey?'已选':period.isCurrent?'进行中':period.isFuture?'未开始':'');
   if(period.isCurrent)button.dataset.current='true';if(period.expenseCents===0)button.dataset.empty='true';
   button.append(amount,track,dates,state);chart.append(button);
  }
  scroll.scrollLeft=left;
  $('spend-chart-label').textContent=`最近 ${periods.length} ${mode==='week'?'周':'个月'} · 元${periods.some(period=>period.expenseCents>=1000000)?'（大额约数）':''}`;
  $('spend-window').textContent=mode==='week'?`周一至周日，跨月按整周计算。更改顶部统计月份可查看其他时段。`:'按自然月计算。更改顶部统计月份可查看其他时段。';
 }
 function drawDetails(){
  const period=selected();if(!period)return;const list=$('spend-detail-list'),records=period.records,visible=records.slice(0,detailLimit);list.replaceChildren();
  $('spend-detail-title').textContent=mode==='week'?'这周的支出流水':'这个月的支出流水';$('spend-detail-count').textContent=records.length?`${Math.min(detailLimit,records.length)} / ${records.length} 笔`:'0 笔';
  $('spend-detail-empty').hidden=Boolean(records.length);$('spend-detail-empty').textContent=period.isFuture?'这段时间尚未开始，未来日期的记录暂不计入。':'这段时间没有已确认支出。新记下的支出会自动显示在这里。';
  let day='';for(const record of visible){const date=record.date.slice(0,10);if(date!==day){day=date;list.append(node('p','spend-detail-day',fullDate(day)));}const row=renderRecord(record);if(row instanceof Node)list.append(row);else if(typeof row==='string'){const template=document.createElement('template');template.innerHTML=row;list.append(template.content);}}
  $('spend-more').hidden=records.length<=detailLimit;$('spend-more').textContent=`再显示 ${Math.min(PAGE_SIZE,Math.max(0,records.length-detailLimit))} 笔`;
 }
 function draw({ensureSelection=false}={}){
  const token=focusToken();for(const value of['week','month']){$('spend-mode-'+value).disabled=false;$('spend-mode-'+value).setAttribute('aria-pressed',String(mode===value));}
  $('spend-state').hidden=true;$('spend-content').hidden=false;drawSummary();drawChart();drawDetails();restoreFocus(token);
  if(ensureSelection){const button=Array.from(host.querySelectorAll('[data-spend-key]')).find(item=>item.dataset.spendKey===selectedKey);if(button){const scroll=$('spend-chart-scroll');scroll.scrollLeft=Math.max(0,button.offsetLeft+button.offsetWidth-scroll.clientWidth);}}
 }
 function calculate({ensureSelection=false}={}){
  if(!input)return;
  try{const result=buildSpendingPeriods(input.records,{mode,anchorMonth:input.anchorMonth,today:input.today,count:6});periods=result.periods;if(!periods.some(period=>period.key===selectedKey))selectedKey=periods.at(-1)?.key||'';draw({ensureSelection});}
  catch{$('spend-state').hidden=false;$('spend-state').dataset.kind='error';$('spend-state').textContent='暂时无法计算支出趋势。请检查顶部统计月份，或重新打开统计页。账目仍保留。';$('spend-content').hidden=true;for(const value of['week','month'])$('spend-mode-'+value).disabled=false;}
 }
 host.addEventListener('click',event=>{
  const modeButton=event.target.closest('[data-spend-mode]');if(modeButton&&host.contains(modeButton)){const next=modeButton.dataset.spendMode;if(!input||!['week','month'].includes(next)||next===mode)return;mode=next;selectedKey='';detailLimit=PAGE_SIZE;calculate({ensureSelection:true});return;}
  const bar=event.target.closest('[data-spend-key]');if(bar&&host.contains(bar)&&periods.some(period=>period.key===bar.dataset.spendKey)){selectedKey=bar.dataset.spendKey;detailLimit=PAGE_SIZE;draw();return;}
  if(event.target.closest('#spend-more')&&input){const token=focusToken();detailLimit+=PAGE_SIZE;drawDetails();restoreFocus(token);}
 });
 return{render(next){const changed=anchorMonth!==next?.anchorMonth;if(changed){anchorMonth=next?.anchorMonth||'';selectedKey='';detailLimit=PAGE_SIZE;}input=next;calculate({ensureSelection:changed});}};
}
