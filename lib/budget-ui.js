import{CATEGORIES,formatMoney,parseMoney}from'./core.js';
import{validDate,localDate}from'./data.js';
import{recordSticker}from'./stickers.js';
import{BUDGET_LIMITS,buildBudgetOverview,budgetPeriod}from'./budgets.js';

const PAGE_SIZE=10,DETAIL_SIZE=20;
const fullDate=value=>`${value.slice(0,4)}.${value.slice(5,7)}.${value.slice(8,10)}`;
const dates=(start,end)=>`${fullDate(start)} — ${fullDate(end)}`;
const fieldNames=['name','category','cycle','start-month','start-date','amount'];
function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;}
function messageText(error,fallback){return typeof error?.message==='string'?error.message.replace(/[\u0000-\u001F\u007F]/g,' ').slice(0,300):fallback;}

/** Budget settings and progress are local. The parent owns all writes, conflict
 * checks and delete confirmations; this view never mutates a ledger snapshot. */
export function createBudgetUI({host,renderRecord,onSavePlan,onRemovePlan,onEditLegacy,onRemoveLegacy,getToday=localDate,getAnchorMonth=()=>getToday().slice(0,7)}){
 if(!host||typeof renderRecord!=='function'||typeof onSavePlan!=='function')throw new TypeError('预算缺少显示或保存入口。');
 let input=null,items=[],pageLimit=PAGE_SIZE,busy=false,editing=null,anchor='',lastTrigger=null;
 const openDetails=new Set(),detailLimits=new Map();
 const $=id=>host.querySelector('#'+id);
 host.innerHTML=`<div class="budget-plan-heading"><div><p class="budget-plan-eyebrow">给每种开销留个额度</p><h2 id="budget-plans-title">预算计划</h2></div><button id="budget-plan-add" type="button" class="button secondary" disabled>新增预算</button></div>
  <p id="budget-plan-status" class="budget-plan-status" role="status">正在整理本机预算…</p>
  <p class="budget-plan-method">各条预算独立计算，同一笔餐饮支出可同时计入餐饮预算和总预算；额度不会相加。已确认的退款抵减对应分类的已用金额，转账和待核对不占额度。</p>
  <div id="budget-plan-list" class="budget-plan-list"></div><button id="budget-plan-more" type="button" class="text-button budget-plan-more" hidden>显示更多预算</button>
  <p class="budget-plan-footnote">更改顶部统计月份可回看预算周期；当前月份按今天所在周期显示，其他月份按月末所在周期显示。预算只做提醒，不限制记账。</p>
  <dialog id="budget-plan-dialog" class="sheet-dialog small-dialog budget-plan-dialog" aria-labelledby="budget-plan-title"><form id="budget-plan-form" novalidate>
   <div class="dialog-heading"><h2 id="budget-plan-title">新增预算</h2><button id="budget-plan-close" type="button" class="icon-button" aria-label="关闭预算设置">×</button></div>
   <div class="budget-plan-presets" role="group" aria-label="常用预算"><button type="button" data-budget-preset="all">总花销</button><button type="button" data-budget-preset="购物">购物</button><button type="button" data-budget-preset="餐饮">餐饮</button></div>
   <p id="budget-plan-edit-note" class="budget-plan-cycle-note" hidden>修改后，各周期将按新设置重新计算；已记流水不变。</p>
   <label class="form-label" for="budget-plan-name">预算名称<input id="budget-plan-name" type="text" maxlength="40" autocomplete="off" placeholder="例如：每月餐食预算"></label>
   <div class="budget-plan-form-grid"><label class="form-label" for="budget-plan-category">统计范围<select id="budget-plan-category"></select></label><label class="form-label" for="budget-plan-amount">每周期额度（元）<input id="budget-plan-amount" type="text" inputmode="decimal" maxlength="15" autocomplete="off" placeholder="例如 1000"></label></div>
   <label class="form-label" for="budget-plan-cycle">预算周期<select id="budget-plan-cycle"><option value="calendar">自然月 · 月初至月底</option><option value="custom">自定义起始日 · 每月重复</option></select></label>
   <label id="budget-plan-month-row" class="form-label" for="budget-plan-start-month">首次开始月份<input id="budget-plan-start-month" type="month" min="1900-01" max="2200-12"></label>
   <label id="budget-plan-date-row" class="form-label" for="budget-plan-start-date" hidden>首次开始日期<input id="budget-plan-start-date" type="date" min="1900-01-01" max="2200-12-31"></label>
   <p id="budget-plan-preview" class="budget-plan-preview" role="status"></p><p class="budget-plan-cycle-note">以后每月按同一天重新开始，额度不结转。选择 29、30 或 31 日时，短月从该月最后一天开始，下个月仍按原来的起始日计算。</p>
   <p id="budget-plan-error" class="form-errors" role="alert" hidden></p><div class="dialog-actions"><button id="budget-plan-dismiss" type="button" class="button secondary">取消</button><button id="budget-plan-save" type="submit" class="button primary">保存预算</button></div>
  </form></dialog>`;
 host.setAttribute('aria-labelledby','budget-plans-title');
 const dialog=$('budget-plan-dialog');
 for(const category of['all',...CATEGORIES]){const option=node('option','',category==='all'?'总花销 · 所有分类':category);option.value=category;$('budget-plan-category').append(option);}

 function status(text='',kind=''){const target=$('budget-plan-status');target.textContent=text;target.dataset.kind=kind;target.hidden=!text;}
 function safeToday(){const today=getToday();return typeof today==='string'&&validDate(today)?today:localDate();}
 function currentMonth(){const value=getAnchorMonth();return typeof value==='string'&&/^\d{4}-\d{2}$/.test(value)&&validDate(value+'-01')?value:safeToday().slice(0,7);}
 function startDate(){return $('budget-plan-cycle').value==='calendar'?$('budget-plan-start-month').value+'-01':$('budget-plan-start-date').value;}
 function formFields(){return{name:$('budget-plan-name').value.trim(),category:$('budget-plan-category').value,amountCents:parseMoney($('budget-plan-amount').value),startDate:startDate()};}
 function syncForm(){
  const custom=$('budget-plan-cycle').value==='custom';$('budget-plan-month-row').hidden=custom;$('budget-plan-date-row').hidden=!custom;
  for(const name of fieldNames)$('budget-plan-'+name).disabled=busy;
  for(const button of host.querySelectorAll('[data-budget-preset]'))button.disabled=busy;
  $('budget-plan-close').disabled=busy;$('budget-plan-dismiss').disabled=busy;$('budget-plan-save').disabled=busy;
  $('budget-plan-save').textContent=busy?'正在保存…':'保存预算';
 }
 function preview(){
  syncForm();const start=startDate();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!validDate(start)){$('budget-plan-preview').textContent='选择首次开始时间后，可查看一个完整周期。';return;}
  try{const stamp=new Date().toISOString(),period=budgetPeriod({id:'preview',name:'周期预览',amountCents:100,category:'all',startDate:start,createdAt:stamp,updatedAt:stamp},{anchorMonth:start.slice(0,7),today:start});$('budget-plan-preview').textContent=`第一个周期：${dates(period.start,period.end)}。之后每月重复。`;}
  catch{$('budget-plan-preview').textContent='暂时无法预览这个日期，请重新选择首次开始时间。';}
 }
 function controls(){
  $('budget-plan-add').disabled=!input||busy||(Array.isArray(input.budgetPlans)&&input.budgetPlans.length>=BUDGET_LIMITS.plans);
  for(const button of host.querySelectorAll('[data-budget-edit],[data-budget-remove],[data-budget-legacy-edit],[data-budget-legacy-remove],[data-budget-detail-more]'))button.disabled=busy;
  $('budget-plan-more').disabled=busy;syncForm();
 }
 function showForm(plan=null,trigger=null){
  if(!input||busy)return;
  if(!plan&&Array.isArray(input.budgetPlans)&&input.budgetPlans.length>=BUDGET_LIMITS.plans){status(`最多可设置 ${BUDGET_LIMITS.plans} 条预算，请先调整已有预算。`,'error');return;}
  editing=plan?{id:plan.id,updatedAt:plan.updatedAt}:null;lastTrigger=trigger||$('budget-plan-add');
  const today=safeToday(),month=currentMonth();$('budget-plan-title').textContent=plan?'编辑预算':'新增预算';
  $('budget-plan-name').value=plan?.name||'总花销预算';$('budget-plan-category').value=plan?.category||'all';$('budget-plan-amount').value=plan?(plan.amountCents/100).toFixed(2):'';
  $('budget-plan-cycle').value=plan&&plan.startDate.slice(8)!=='01'?'custom':'calendar';
  $('budget-plan-start-month').value=plan?plan.startDate.slice(0,7):month;$('budget-plan-start-date').value=plan?plan.startDate:month===today.slice(0,7)?today:month+'-01';
  $('budget-plan-error').hidden=true;$('budget-plan-edit-note').hidden=!plan;preview();dialog.showModal();$('budget-plan-name').focus({preventScroll:true});
 }
 function closeForm(){if(busy)return;dialog.close();editing=null;const trigger=lastTrigger;lastTrigger=null;if(trigger?.isConnected&&!trigger.disabled)trigger.focus({preventScroll:true});}
 function formError(message){$('budget-plan-error').textContent=message;$('budget-plan-error').hidden=false;}
 function focusToken(){const active=document.activeElement;if(!active||!host.contains(active)||dialog.contains(active))return null;for(const attribute of['budgetEdit','budgetRemove','budgetLegacyEdit','budgetLegacyRemove','budgetDetailMore'])if(active.dataset?.[attribute])return{attribute,value:active.dataset[attribute]};if(active.id==='budget-plan-add'||active.id==='budget-plan-more')return{id:active.id};return null;}
 function restoreFocus(token){if(!token)return;const target=token.id?$(token.id):Array.from(host.querySelectorAll('button')).find(button=>button.dataset[token.attribute]===token.value);if(target&&!target.hidden&&!target.disabled)target.focus({preventScroll:true});}
 function renderRows(item,list,limit){
  const records=item.records||[];list.replaceChildren();let previous='';
  for(const record of records.slice(0,limit)){const day=record.date.slice(0,10);if(day!==previous){previous=day;list.append(node('p','budget-route-day',fullDate(day)));}const row=renderRecord(record);if(row instanceof Node)list.append(row);else if(typeof row==='string'){const template=document.createElement('template');template.innerHTML=row;list.append(template.content);}}
 }
 function card(item){
  const card=node('article','budget-route-card');card.dataset.budgetId=item.id;card.dataset.budgetKind=item.kind;card.dataset.budgetAmount=String(item.amountCents);card.dataset.budgetUsed=String(item.usedCents);card.dataset.budgetRemaining=String(item.remainingCents);if(item.isFuture)card.dataset.planned='true';
  const heading=node('div','budget-route-heading'),mark=node('span','budget-route-sticker');mark.innerHTML=recordSticker({category:item.category==='all'?'其他':item.category,type:'expense'});const title=node('div','budget-route-title');title.append(node('h3','',item.name),node('p','budget-route-scope',(item.category==='all'?'总花销 · 所有分类':item.category)+(item.kind==='legacy'?' · 原单月设置':'')));heading.append(mark,title);card.append(heading);
  card.append(node('p','budget-route-period',dates(item.start,item.end)+(item.isFuture?' · 尚未开始':item.end>input.today?` · 截至 ${fullDate(item.effectiveEnd)}`:'')));
  const over=item.remainingCents<0,remaining=node('div','budget-route-balance');remaining.dataset.over=String(over);remaining.append(node('span','',over?'已超出预算':'剩余额度'),node('strong','budget-route-remaining',formatMoney(Math.abs(item.remainingCents))));card.append(remaining);
  const pair=node('div','budget-route-pair'),allowance=node('span','');allowance.append(node('small','','周期额度'),node('strong','',formatMoney(item.amountCents)));const used=node('span','');used.append(node('small','','已用 · 扣除退款'),node('strong','budget-route-used',formatMoney(item.usedCents)));pair.append(allowance,used);card.append(pair);
  const percentage=Math.max(0,Math.min(100,item.usedCents/item.amountCents*100)),track=node('div','budget-route-track'),fill=node('span','');track.setAttribute('role','progressbar');track.setAttribute('aria-label',`${item.name}预算使用进度`);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',String(Math.round(percentage)));track.setAttribute('aria-valuetext',`已用 ${formatMoney(item.usedCents)}，周期额度 ${formatMoney(item.amountCents)}${over?'，已超出':''}`);track.dataset.over=String(over);fill.style.width=percentage+'%';track.append(fill);card.append(track);
  const explain=item.isFuture?'首次开始后，已确认支出会自动计入本周期。':`支出 ${formatMoney(item.expenseCents)} · 退款 ${formatMoney(item.refundCents)}${item.netExpenseCents<0?'；本周期净退款较多，已用按 ¥0.00 计算。':''}`;card.append(node('p','budget-route-breakdown',explain));
  if(item.kind==='legacy')card.append(node('p','budget-route-legacy-note','这条原设置只覆盖所选月份；需要每月重复或自定义周期，可新增预算。'));
  const actions=node('div','budget-route-actions'),edit=node('button','text-button',item.kind==='legacy'?'调整本月额度':'编辑'),remove=node('button','text-button budget-route-delete','删除');edit.type=remove.type='button';
  if(item.kind==='legacy'){edit.dataset.budgetLegacyEdit=item.legacyMonth;remove.dataset.budgetLegacyRemove=item.legacyMonth;}else{edit.dataset.budgetEdit=item.id;remove.dataset.budgetRemove=item.id;}
  edit.setAttribute('aria-label',`编辑${item.name}`);remove.setAttribute('aria-label',`删除${item.name}`);actions.append(edit,remove);card.append(actions);
  const details=node('details','budget-route-details');details.dataset.budgetDetails=item.id;const count=(item.records||[]).length;details.append(node('summary','',`查看支出与退款流水 · ${count} 笔`));const list=node('div','budget-route-records');details.append(list);
  if(!count)list.append(node('p','budget-route-empty',item.isFuture?'这段时间尚未开始。':'本周期没有匹配的已确认支出或退款。'));
  const more=node('button','text-button budget-route-more','');more.type='button';more.dataset.budgetDetailMore=item.id;details.append(more);
  const renderDetail=()=>{const limit=detailLimits.get(item.id)||DETAIL_SIZE;if(count)renderRows(item,list,limit);more.hidden=count<=limit;more.textContent=`再显示 ${Math.min(DETAIL_SIZE,Math.max(0,count-limit))} 笔`;} ;
  if(openDetails.has(item.id)){details.open=true;renderDetail();}else more.hidden=true;
  details.addEventListener('toggle',()=>{if(details.open){openDetails.add(item.id);renderDetail();}else openDetails.delete(item.id);});card.append(details);return card;
 }
 function draw(){
  const token=focusToken(),list=$('budget-plan-list');list.replaceChildren();
  if(!items.length){const empty=node('div','budget-plan-empty');empty.append(node('h3','','给开销定个小目标'),node('p','','先设置一条总预算，也可分别设置餐饮、购物等分类预算。每条都能选择自己的起始日。'));list.append(empty);}
  for(const item of items.slice(0,pageLimit))list.append(card(item));
  $('budget-plan-more').hidden=items.length<=pageLimit;$('budget-plan-more').textContent=`再显示 ${Math.min(PAGE_SIZE,Math.max(0,items.length-pageLimit))} 条预算`;
  controls();restoreFocus(token);
 }
 function calculate(){
  if(!input)return;
  try{items=buildBudgetOverview(input,{anchorMonth:input.anchorMonth,today:input.today}).items;draw();const plans=input.budgetPlans||[];status(plans.length>=BUDGET_LIMITS.plans?`已有 ${BUDGET_LIMITS.plans} 条预算，可编辑或删除已有计划。`:'');}
  catch{items=[];$('budget-plan-list').replaceChildren();$('budget-plan-more').hidden=true;status('暂时无法计算预算，请检查统计月份或重新打开统计页。已有预算仍保留。','error');controls();}
 }
 async function save(event){
  event.preventDefault();if(busy)return;const fields=formFields();
  if(!fields.name||fields.name.length>BUDGET_LIMITS.nameChars||/[\u0000-\u001F\u007F]/.test(fields.name)){formError(`请填写不超过 ${BUDGET_LIMITS.nameChars} 字的预算名称。`);$('budget-plan-name').focus();return;}
  if(!['all',...CATEGORIES].includes(fields.category)){formError('请选择总花销或一个现有分类。');return;}
  if(!Number.isSafeInteger(fields.amountCents)||fields.amountCents<=0||fields.amountCents>BUDGET_LIMITS.maxCents){formError('请输入大于 0、最多两位小数且不超过 999,999,999.99 元的额度。');$('budget-plan-amount').focus();return;}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(fields.startDate)||!validDate(fields.startDate)){formError('请选择有效的首次开始月份或日期。');return;}
  busy=true;$('budget-plan-error').hidden=true;controls();
  try{const result=await onSavePlan(fields,{existingId:editing?.id||'',expectedUpdatedAt:editing?.updatedAt});if(result===false)throw new Error('这次预算没有保存，请核对后重试。');busy=false;closeForm();status('预算已保存，已用金额和剩余额度按所示周期计算。');}
  catch(error){formError(messageText(error,'预算没有保存，请核对后重试。'));}
  finally{busy=false;controls();}
 }
 async function remove(item){
  if(busy)return;const callback=item.kind==='legacy'?onRemoveLegacy:onRemovePlan;if(typeof callback!=='function')return;busy=true;controls();
  try{await callback(item.kind==='legacy'?item.legacyMonth:item.plan);}
  catch(error){status(messageText(error,'未能删除预算，原设置仍保留。'),'error');}
  finally{busy=false;controls();}
 }
 $('budget-plan-add').addEventListener('click',event=>showForm(null,event.currentTarget));$('budget-plan-form').addEventListener('submit',save);
 for(const id of['budget-plan-close','budget-plan-dismiss'])$(id).addEventListener('click',closeForm);
 dialog.addEventListener('cancel',event=>{event.preventDefault();closeForm();});
 dialog.addEventListener('close',()=>{if(!busy)editing=null;});
 for(const name of fieldNames)$('budget-plan-'+name).addEventListener('input',()=>{if(name==='cycle'||name==='start-month'||name==='start-date')preview();});
 host.addEventListener('click',event=>{
  const preset=event.target.closest('[data-budget-preset]');if(preset&&!busy){const category=preset.dataset.budgetPreset;if(['all','购物','餐饮'].includes(category)){$('budget-plan-name').value=(category==='all'?'总花销':category)+'预算';$('budget-plan-category').value=category;}return;}
  const edit=event.target.closest('[data-budget-edit]');if(edit){const item=items.find(item=>item.id===edit.dataset.budgetEdit&&item.kind==='plan');if(item)showForm(item.plan,edit);return;}
  const legacy=event.target.closest('[data-budget-legacy-edit]');if(legacy&&!busy){onEditLegacy?.(legacy.dataset.budgetLegacyEdit);return;}
  const removing=event.target.closest('[data-budget-remove],[data-budget-legacy-remove]');if(removing){const item=items.find(item=>(item.kind==='plan'&&item.id===removing.dataset.budgetRemove)||(item.kind==='legacy'&&item.legacyMonth===removing.dataset.budgetLegacyRemove));if(item)remove(item);return;}
  const more=event.target.closest('[data-budget-detail-more]');if(more&&!busy){const item=items.find(item=>item.id===more.dataset.budgetDetailMore),details=more.closest('details');if(item&&details){const limit=(detailLimits.get(item.id)||DETAIL_SIZE)+DETAIL_SIZE;detailLimits.set(item.id,limit);renderRows(item,details.querySelector('.budget-route-records'),limit);more.hidden=(item.records||[]).length<=limit;more.textContent=`再显示 ${Math.min(DETAIL_SIZE,Math.max(0,(item.records||[]).length-limit))} 笔`;if(more.hidden)details.querySelector('summary')?.focus({preventScroll:true});}return;}
  if(event.target.closest('#budget-plan-more')&&!busy){pageLimit+=PAGE_SIZE;draw();}
 });
 return{render(next){if(anchor!==next?.anchorMonth){anchor=next?.anchorMonth||'';pageLimit=PAGE_SIZE;openDetails.clear();detailLimits.clear();}input=next;calculate();},hasUnsavedWork:()=>Boolean(busy||dialog.open)};
}
