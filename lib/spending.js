import{localDate,validDate}from'./data.js';

const DAY=86400000,MAX_CENTS=99999999999;
const MODES=new Set(['week','month']);
const iso=value=>new Date(value).toISOString().slice(0,10);
const dayValue=value=>Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7))-1,Number(value.slice(8,10)));
const shiftDays=(value,days)=>iso(dayValue(value)+days*DAY);
function firstOfMonth(value,offset=0){return iso(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7))-1+offset,1));}
function lastOfMonth(value){return iso(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7)),0));}
function startOfWeek(value){const weekday=new Date(dayValue(value)).getUTCDay();return shiftDays(value,-((weekday+6)%7));}
function addCents(total,amount){const value=total+amount;if(!Number.isSafeInteger(value))throw new RangeError('支出合计超出可安全计算范围。');return value;}
function summarizeRange(records,start,end){
 if(!end||end<start)return{expenseCents:0,count:0,records:[]};
 const matched=[];let expenseCents=0;
 for(const record of records){const day=record.date.slice(0,10);if(day<start||day>end)continue;expenseCents=addCents(expenseCents,record.amountCents);matched.push(record);}
 return{expenseCents,count:matched.length,records:matched};
}

/** Calendar-only spending windows. Week boundaries are Monday/Sunday, never
 * UTC conversions of a device's local midnight. No ledger writes or network.
 * Amounts are gross confirmed expenses; refunds are deliberately separate. */
export function buildSpendingPeriods(records=[],{mode='week',anchorMonth,today=localDate(),count=6}={}){
 if(!Array.isArray(records)||!MODES.has(mode)||typeof today!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(today)||!validDate(today)||!Number.isInteger(count)||count<1||count>24)throw new TypeError('支出统计条件无效，请重新选择周、月或日期。');
 const month=anchorMonth===undefined?today.slice(0,7):anchorMonth;
 if(typeof month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)||!validDate(month+'-01'))throw new TypeError('统计月份无效，请重新选择。');
 const anchor=mode==='week'?startOfWeek(month===today.slice(0,7)?today:lastOfMonth(month)):month+'-01';
 // Only the displayed windows and their preceding comparison can contribute.
 // Avoid sorting years of unrelated history on every local ledger update.
 const rangeStart=mode==='week'?shiftDays(anchor,-count*7):firstOfMonth(anchor,-count),lastEnd=mode==='week'?shiftDays(anchor,6):lastOfMonth(anchor),rangeEnd=lastEnd<today?lastEnd:today;
 const eligible=records.filter(record=>record&&record.status==='confirmed'&&record.type==='expense'&&Number.isSafeInteger(record.amountCents)&&record.amountCents>0&&record.amountCents<=MAX_CENTS&&validDate(record.date)&&record.date.slice(0,10)>=rangeStart&&record.date.slice(0,10)<=rangeEnd)
  .sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
 const periods=[];
 for(let index=count-1;index>=0;index--){
  const start=mode==='week'?shiftDays(anchor,-index*7):firstOfMonth(anchor,-index),end=mode==='week'?shiftDays(start,6):lastOfMonth(start);
  const isCurrent=start<=today&&today<=end,isFuture=start>today,effectiveEnd=isFuture?'':end<today?end:today;
  const current=summarizeRange(eligible,start,effectiveEnd),previousStart=mode==='week'?shiftDays(start,-7):firstOfMonth(start,-1),previousEnd=mode==='week'?shiftDays(start,-1):lastOfMonth(previousStart);
  const partial=isCurrent&&today<end;
  let comparisonEnd=previousEnd;
  if(partial){
   const elapsed=Math.round((dayValue(today)-dayValue(start))/DAY);
   const sameProgress=shiftDays(previousStart,elapsed);
   comparisonEnd=sameProgress<previousEnd?sameProgress:previousEnd;
  }
  const previous=isFuture?{expenseCents:0,count:0}:summarizeRange(eligible,previousStart,comparisonEnd);
  const deltaCents=isFuture?0:current.expenseCents-previous.expenseCents;
  const percent=!isFuture&&previous.expenseCents>0?deltaCents/previous.expenseCents*100:null;
  const kind=isFuture?'future':deltaCents===0?'flat':previous.expenseCents===0?'new':deltaCents>0?'up':'down';
  periods.push({key:start,start,end,effectiveEnd,...current,isCurrent,isFuture,comparison:{start:previousStart,end:comparisonEnd,expenseCents:previous.expenseCents,count:previous.count,deltaCents,percent,kind,partial}});
 }
 return{mode,periods};
}
