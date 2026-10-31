import{localDate,validDate}from'./data.js';

export const BUDGET_LIMITS=Object.freeze({plans:50,maxCents:99999999999,nameChars:40});
// Keep this validation independent of core.js: backup parsing imports this
// module, while the existing core module imports data.js date functions.
const CATEGORIES=new Set(['餐饮','交通','购物','住房','日用','健康','娱乐','其他']);
const FIELDS=['id','name','amountCents','category','startDate','createdAt','updatedAt'];
const DAY=86400000;
const iso=value=>new Date(value).toISOString().slice(0,10);
const dayValue=value=>Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7))-1,Number(value.slice(8,10)));
const shiftDays=(value,days)=>iso(dayValue(value)+days*DAY);
const firstOfMonth=(value,offset=0)=>iso(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7))-1+offset,1));
const lastOfMonth=value=>iso(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7)),0));
const dateOnly=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&validDate(value);
function invalid(message='预算资料不完整或格式不正确，请检查名称、额度和开始日期。'){const error=new Error(message);error.name='BudgetValidationError';error.code='BUDGET_INVALID';return error;}
function object(value){if(!value||typeof value!=='object'||Array.isArray(value))return false;const prototype=Object.getPrototypeOf(value);return prototype===Object.prototype||prototype===null;}
function stamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!validDate(value.slice(0,19)))throw invalid();
 const date=new Date(value);if(!Number.isFinite(date.getTime()))throw invalid();return date.toISOString();
}
function amount(value){return Number.isSafeInteger(value)&&value>0&&value<=BUDGET_LIMITS.maxCents;}
function addCents(total,value){const next=total+value;if(!Number.isSafeInteger(next))throw new RangeError('预算周期内的金额合计超出可安全计算范围。');return next;}
function options({anchorMonth,today=localDate()}={}){
 if(!dateOnly(today))throw invalid('预算统计日期无效，请重新打开页面。');
 const month=anchorMonth===undefined?today.slice(0,7):anchorMonth;
 if(typeof month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)||!validDate(month+'-01'))throw invalid('预算统计月份无效，请重新选择。');
 return{today,month,reference:month===today.slice(0,7)?today:lastOfMonth(month)};
}

/** A plan is a recurring monthly rule, not a copy of a month's ledger. The
 * original start day is retained even when February needs a shorter anchor. */
export function normalizeBudgetPlan(value){
 if(!object(value)||Object.keys(value).length!==FIELDS.length||FIELDS.some(field=>!Object.hasOwn(value,field)))throw invalid();
 if(typeof value.id!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(value.id)||value.id.startsWith('legacy-')||typeof value.name!=='string'||value.name.length>BUDGET_LIMITS.nameChars||!value.name.trim()||/[\u0000-\u001F\u007F]/.test(value.name)||!amount(value.amountCents)||(value.category!=='all'&&!CATEGORIES.has(value.category))||!dateOnly(value.startDate))throw invalid();
 return{id:value.id,name:value.name.trim(),amountCents:value.amountCents,category:value.category,startDate:value.startDate,createdAt:stamp(value.createdAt),updatedAt:stamp(value.updatedAt)};
}

export function normalizeBudgetPlans(value){
 if(value===undefined)return[];
 if(!Array.isArray(value)||value.length>BUDGET_LIMITS.plans)throw invalid(`最多可保存 ${BUDGET_LIMITS.plans} 条预算，请先整理后再添加。`);
 const seen=new Set();return Array.from(value,source=>{const plan=normalizeBudgetPlan(source);if(seen.has(plan.id))throw invalid('预算中存在重复的标识，未覆盖现有设置。');seen.add(plan.id);return plan;});
}

/** Backup restore adds distinct plans; an existing local id always wins. A
 * limit error rejects the whole merge rather than silently omitting routes. */
export function mergeBudgetPlans(local,incoming){
 const existing=normalizeBudgetPlans(local),received=normalizeBudgetPlans(incoming),ids=new Set(existing.map(plan=>plan.id));
 for(const plan of received)if(!ids.has(plan.id)){existing.push(plan);ids.add(plan.id);}
 if(existing.length>BUDGET_LIMITS.plans)throw invalid(`合并后超过 ${BUDGET_LIMITS.plans} 条预算，未更改本机设置。请先整理预算后重试。`);
 return existing;
}

function anchorInMonth(month,day){return iso(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1,Math.min(day,Number(lastOfMonth(month).slice(8,10)))));}
function periodFor(plan,{reference,today}){
 const originalDay=Number(plan.startDate.slice(8,10));let start;
 const beforeActivation=reference<plan.startDate;
 if(beforeActivation)start=plan.startDate;
 else{start=anchorInMonth(reference,originalDay);if(start>reference)start=anchorInMonth(firstOfMonth(reference,-1),originalDay);}
 const end=shiftDays(anchorInMonth(firstOfMonth(start,1),originalDay),-1),isFuture=beforeActivation||start>today;
 return{start,end,effectiveEnd:isFuture?'':end<today?end:today,isFuture};
}

export function budgetPeriod(plan,settings){return periodFor(normalizeBudgetPlan(plan),options(settings));}

function usageFor(snapshot,records){
 let expenseCents=0,refundCents=0,expenseCount=0,refundCount=0;const matched=[];
 if(!snapshot.isFuture)for(const record of records){
  const date=record.date.slice(0,10);if(date<snapshot.start||date>snapshot.effectiveEnd||(snapshot.category!=='all'&&record.category!==snapshot.category))continue;
  if(record.type==='expense'){expenseCents=addCents(expenseCents,record.amountCents);expenseCount++;}else{refundCents=addCents(refundCents,record.amountCents);refundCount++;}matched.push(record);
 }
 const netExpenseCents=expenseCents-refundCents,usedCents=Math.max(0,netExpenseCents),remainingCents=snapshot.amountCents-usedCents;
 return{...snapshot,expenseCents,refundCents,netExpenseCents,usedCents,remainingCents,expenseCount,refundCount,count:matched.length,records:matched};
}

/** All routes are independent views of the same confirmed ledger. A meal may
 * consume both a total budget and a dining budget; their limits are not added.
 * Refunds follow their own confirmed date/category and cannot raise remaining
 * funds above the configured allowance. No writes, storage or network. */
export function buildBudgetOverview({records=[],budgets={},budgetPlans=[]}={},settings){
 if(!Array.isArray(records)||!object(budgets))throw invalid();
 const context=options(settings),plans=normalizeBudgetPlans(budgetPlans),snapshots=[];
 const legacy=Object.hasOwn(budgets,context.month)?budgets[context.month]:null;
 if(amount(legacy)){
  const start=context.month+'-01',end=lastOfMonth(start),isFuture=start>context.today;
  snapshots.push({id:'legacy-'+context.month,kind:'legacy',legacyMonth:context.month,name:'本月总预算（原设置）',category:'all',amountCents:legacy,start,end,effectiveEnd:isFuture?'':end<context.today?end:context.today,isFuture});
 }
 for(const plan of plans)snapshots.push({id:plan.id,kind:'plan',plan,name:plan.name,category:plan.category,amountCents:plan.amountCents,...periodFor(plan,context)});
 const active=snapshots.filter(snapshot=>!snapshot.isFuture);
 if(!active.length)return{items:snapshots.map(snapshot=>usageFor(snapshot,[]))};
 const lower=active.reduce((start,snapshot)=>snapshot.start<start?snapshot.start:start,active[0].start),upper=active.reduce((end,snapshot)=>snapshot.effectiveEnd>end?snapshot.effectiveEnd:end,active[0].effectiveEnd);
 const eligible=records.filter(record=>record&&record.status==='confirmed'&&['expense','refund'].includes(record.type)&&amount(record.amountCents)&&validDate(record.date)&&record.date.slice(0,10)>=lower&&record.date.slice(0,10)<=upper)
  .sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
 return{items:snapshots.map(snapshot=>usageFor(snapshot,eligible))};
}
