import{CATEGORIES}from'./core.js';
import{validDate}from'./data.js';

const DATABASE='qingji-ai-chat-history-v1',STORE='conversations',VERSION=1;
const LIMITS=Object.freeze({turns:128,cards:40,text:6000,images:20,imageBytes:200*1024,imageEdge:320});
const STATES=new Set(['pending','saved','replaced','cancelled','undone']);
const TYPES=new Set(['expense','income','refund','transfer']);
const CHANNELS=new Set(['微信','支付宝','其他']);
const CURRENCIES=new Set(['CNY','UNKNOWN','OTHER']);
const PAYMENTS=new Set(['stated','completed','uncertain','not_completed']);
const CATEGORY_SET=new Set(CATEGORIES);
const IMAGE_STATES=new Set(['identified','needs_review','not_transaction','unreadable']);
const SENSITIVE=/交易单号|订单号|流水号|收款账户|付款账户|对方账户|账户姓名|账号|帐号|卡号|身份证|证件号|手机号码?|电话号码?|验证码|密码|密钥|api[ _-]*key|access[ _-]*token|secret[ _-]*key|password|verification[ _-]*code|authorization|bearer\s+/i;
const MESSAGES={unsupported:'当前浏览器不支持保存对话记录，请在 Safari 普通浏览模式使用。',blocked:'对话记录暂被其他页面占用，请关闭重复页面后重试。',storage:'对话记录未能保存或读取，请检查浏览器存储权限和可用空间。账本不受影响。',invalid:'这段对话的数据不完整，未覆盖原有记录。',corrupt:'这段对话记录不完整，暂时无法打开。',conflict:'其他页面已修改这段对话，未覆盖已保存的记录。',cleared:'这段对话已被其他页面清除，未重新保存旧记录。'};
function error(code){const value=new Error(MESSAGES[code]||MESSAGES.storage);value.name='ChatHistoryError';value.code=code;return value;}
function object(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function id(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(value))throw error('invalid');return value;}
function stamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!validDate(value.slice(0,19)))throw error('invalid');
 const date=new Date(value);if(!Number.isFinite(date.getTime()))throw error('invalid');return date.toISOString();
}

/** Device-only chat display text. Credential-labelled lines and common key
 * shapes are removed. The caller must also replace its actual session key
 * before passing a snapshot; a custom unlabelled key has no reliable shape. */
export function redactHistoryText(input,max=LIMITS.text){
 if(typeof input!=='string')return'';
 const lines=input.slice(0,24000).replace(/\r/g,'').split('\n'),kept=[];let skipValue=false;
 for(const source of lines){
  const line=source.trim();
  if(SENSITIVE.test(line)){kept.push('[已隐藏敏感信息]');skipValue=true;continue;}
  if(skipValue&&/^[A-Za-z0-9*._@+\/=-]{5,}$/.test(line)){skipValue=false;continue;}skipValue=false;
  kept.push(line.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g,'[已隐藏密钥]')
   .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[已隐藏邮箱]')
   .replace(/\b(?=[A-Za-z0-9_-]{16,}\b)(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g,'[已隐藏编号]')
   .replace(/\d{7,}/g,'[已隐藏编号]').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,''));
 }
 return kept.join('\n').trim().slice(0,Math.min(LIMITS.text,Math.max(0,Number.isInteger(max)?max:LIMITS.text)));
}

// Store the small display thumbnail only. Checking JPEG SOF dimensions also
// prevents a compactly encoded full screenshot being saved as a "thumbnail".
function thumbnail(value){
 if(typeof value!=='string'||value.length>Math.ceil(LIMITS.imageBytes/3)*4+32)return'';
 const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);if(!match||match[1].length%4)return'';
 const bytes=match[1].length*3/4-(match[1].endsWith('==')?2:match[1].endsWith('=')?1:0);if(bytes>LIMITS.imageBytes)return'';
 try{
  const binary=atob(match[1]);if(binary.length<10||binary.charCodeAt(0)!==255||binary.charCodeAt(1)!==216)return'';
  let offset=2;
  while(offset+3<binary.length){
   if(binary.charCodeAt(offset)!==255)return'';while(binary.charCodeAt(offset)===255)offset++;
   const marker=binary.charCodeAt(offset++);if(marker===217||marker===218)return'';
   if(marker===216||marker===1||(marker>=208&&marker<=215))continue;
   const size=(binary.charCodeAt(offset)<<8)+binary.charCodeAt(offset+1);if(size<2||offset+size>binary.length)return'';
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
    if(size<8)return'';const height=(binary.charCodeAt(offset+3)<<8)+binary.charCodeAt(offset+4),width=(binary.charCodeAt(offset+5)<<8)+binary.charCodeAt(offset+6);
    return width>0&&height>0&&width<=LIMITS.imageEdge&&height<=LIMITS.imageEdge&&width*height<=100000?value:'';
   }
   offset+=size;
  }
 }catch{}
 return'';
}

function card(source){
 if(!object(source)||!object(source.draft))throw error('invalid');
 const cardId=id(source.id),raw=source.draft,amount=raw.amountCents;
 const amountCents=amount===null||Number.isSafeInteger(amount)&&amount>0&&amount<=99999999999?amount:null;
 const date=typeof raw.date==='string'&&validDate(raw.date)?raw.date:'';
 const merchant=redactHistoryText(raw.merchant,100),currency=CURRENCIES.has(raw.currency)?raw.currency:'UNKNOWN',paymentState=PAYMENTS.has(raw.paymentState)?raw.paymentState:'uncertain';
 const needsAttention=raw.needsAttention===true||amountCents===null||!merchant||!date||currency!=='CNY'||['uncertain','not_completed'].includes(paymentState);
 let state=STATES.has(source.state)?source.state:'pending';
 const savedOnce=source.savedOnce===true;
 if(state==='saved'&&!savedOnce)state='pending';
 return{id:cardId,state,savedOnce,draft:{id:cardId,amountCents,type:TYPES.has(raw.type)?raw.type:'expense',date,merchant,category:CATEGORY_SET.has(raw.category)?raw.category:'其他',purpose:redactHistoryText(raw.purpose,40),channel:CHANNELS.has(raw.channel)?raw.channel:'其他',notes:redactHistoryText(raw.notes,200),currency,paymentState,needsAttention,...(Number.isInteger(raw.imageIndex)&&raw.imageIndex>=1&&raw.imageIndex<=LIMITS.images?{imageIndex:raw.imageIndex}:{})},notice:redactHistoryText(source.notice,300),manualReview:source.manualReview===true};
}

/** Whitelist a conversation snapshot. No endpoint, key, consent, raw image,
 * request preview, speech recording, worker, or ledger object is persisted. */
export function normalizeConversation(source){
 if(!object(source)||!Array.isArray(source.turns)||source.turns.length>LIMITS.turns)throw error('invalid');
 const conversationId=id(source.id),createdAt=stamp(source.createdAt),updatedAt=stamp(source.updatedAt);
 if(updatedAt<createdAt)throw error('invalid');
 const turns=Array.from(source.turns,sourceTurn=>{
  if(!object(sourceTurn)||!['user','assistant'].includes(sourceTurn.role))throw error('invalid');
  const at=sourceTurn.at===undefined?updatedAt:stamp(sourceTurn.at),text=redactHistoryText(sourceTurn.text),imageThumb=thumbnail(sourceTurn.imageThumb);
  const turn={role:sourceTurn.role,text,at};
  if(imageThumb)turn.imageThumb=imageThumb;
  else if(sourceTurn.imageOmitted===true||typeof sourceTurn.imageThumb==='string'&&sourceTurn.imageThumb)turn.imageOmitted=true;
  if(sourceTurn.imageThumbs!==undefined){
   if(!Array.isArray(sourceTurn.imageThumbs)||sourceTurn.imageThumbs.length>LIMITS.images)throw error('invalid');
   if(sourceTurn.imageThumbs.length){turn.imageThumbs=Array.from(sourceTurn.imageThumbs,thumbnail);delete turn.imageThumb;if(turn.imageThumbs.some(value=>!value))turn.imageOmitted=true;}
  }
  if(sourceTurn.imageResults!==undefined){
   if(!Array.isArray(sourceTurn.imageResults)||sourceTurn.imageResults.length>LIMITS.images)throw error('invalid');
   const indices=new Set();turn.imageResults=Array.from(sourceTurn.imageResults,value=>{if(!object(value)||!Number.isInteger(value.imageIndex)||value.imageIndex<1||value.imageIndex>LIMITS.images||indices.has(value.imageIndex)||!IMAGE_STATES.has(value.status))throw error('invalid');indices.add(value.imageIndex);return{imageIndex:value.imageIndex,status:value.status,reason:redactHistoryText(value.reason,300)};});
  }
  if(Number.isInteger(sourceTurn.voiceDuration)&&sourceTurn.voiceDuration>0&&sourceTurn.voiceDuration<=60)turn.voiceDuration=sourceTurn.voiceDuration;
  if(sourceTurn.failed===true)turn.failed=true;
  if(sourceTurn.cards!==undefined){if(!Array.isArray(sourceTurn.cards)||sourceTurn.cards.length>LIMITS.cards)throw error('invalid');turn.cards=Array.from(sourceTurn.cards,card);}
  return turn;
 });
 return{id:conversationId,createdAt,updatedAt,turns};
}

function metadata(conversation){
 let title='记账对话';
 for(const turn of conversation.turns){if(turn.role!=='user')continue;if(turn.text){title=turn.text.replace(/\s+/g,' ').slice(0,36);break;}if(turn.imageThumbs?.length){title=`${turn.imageThumbs.length} 张图片记账`;break;}if(turn.imageThumb||turn.imageOmitted){title='图片记账';break;}}
 const savedIds=new Set(conversation.turns.flatMap(turn=>turn.cards||[]).filter(value=>value.savedOnce).map(value=>value.id));
 return{id:conversation.id,title,createdAt:conversation.createdAt,updatedAt:conversation.updatedAt,turnCount:conversation.turns.length,recordCount:savedIds.size};
}

function openDatabase(){
 if(!globalThis.indexedDB)throw error('unsupported');
 return new Promise((resolve,reject)=>{
  let request,settled=false;const fail=code=>{if(settled)return;settled=true;clearTimeout(timer);reject(error(code));};
  const timer=setTimeout(()=>fail('blocked'),5000);
  try{request=indexedDB.open(DATABASE,VERSION);}catch{fail('storage');return;}
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'id'});};
  request.onblocked=()=>fail('blocked');request.onerror=()=>fail('storage');
  request.onsuccess=()=>{const db=request.result;if(settled){db.close();return;}settled=true;clearTimeout(timer);db.onversionchange=()=>db.close();resolve(db);};
 });
}
function transact(db,mode,operation){
 return new Promise((resolve,reject)=>{
  let tx,result,settled=false;const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);reject(error('storage'));};
  const timer=setTimeout(()=>{try{tx?.abort();}catch{}fail();},5000);
  try{tx=db.transaction(STORE,mode);const request=operation(tx.objectStore(STORE));request.onsuccess=()=>{result=request.result;};request.onerror=fail;tx.onerror=fail;tx.onabort=fail;tx.oncomplete=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result);};}catch{try{tx?.abort();}catch{}fail();}
 });
}

// The comparison and write share one readwrite transaction. Separate tabs
// cannot both succeed against the same old revision when their timestamps
// advance. A failed comparison aborts without altering the existing entry.
function compareAndSave(db,snapshot,expectedUpdatedAt){
 return new Promise((resolve,reject)=>{
  let tx,settled=false,abortReason='storage';
  const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);reject(error(abortReason));};
  const timer=setTimeout(()=>{try{tx?.abort();}catch{}fail();},5000);
  try{
   tx=db.transaction(STORE,'readwrite');const store=tx.objectStore(STORE),read=store.get(snapshot.id);
   read.onerror=fail;
   read.onsuccess=()=>{
    try{
     const current=read.result;
     if(expectedUpdatedAt!==null&&current===undefined){abortReason='cleared';tx.abort();return;}
     if(expectedUpdatedAt===null?current!==undefined:current?.updatedAt!==expectedUpdatedAt){abortReason='conflict';tx.abort();return;}
     const write=store.put(snapshot);write.onerror=fail;
    }catch{try{tx.abort();}catch{}fail();}
   };
   tx.onerror=fail;tx.onabort=fail;
   tx.oncomplete=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve(snapshot);};
  }catch{try{tx?.abort();}catch{}fail();}
 });
}

/** Lazy, device-only persistence in a database separate from both the ledger
 * and the optional credential vault. No retention deletion or network access.
 * Calls are queued per instance; each save writes one conversation ID only.
 * close() stops new operations without cancelling an already queued write. */
export function createChatHistory(){
 let pending=Promise.resolve(),closed=false;
 const serial=task=>{if(closed)return Promise.reject(error('storage'));const operation=pending.then(task,task);pending=operation.catch(()=>{});return operation;};
 const use=async(mode,operation)=>{const db=await openDatabase();try{return await transact(db,mode,operation);}finally{db.close();}};
 return Object.freeze({
  save(source,options={}){let snapshot,expectedUpdatedAt;try{snapshot=normalizeConversation(source);if(!object(options))throw error('invalid');expectedUpdatedAt=options.expectedUpdatedAt;if(expectedUpdatedAt!==undefined&&expectedUpdatedAt!==null)stamp(expectedUpdatedAt);}catch{return Promise.reject(error('invalid'));}return serial(async()=>{if(expectedUpdatedAt===undefined)await use('readwrite',store=>store.put(snapshot));else{const db=await openDatabase();try{await compareAndSave(db,snapshot,expectedUpdatedAt);}finally{db.close();}}return snapshot;});},
  list(){return serial(async()=>{const entries=await use('readonly',store=>store.getAll()),result=[];for(const source of entries){try{result.push(metadata(normalizeConversation(source)));}catch{/* One damaged conversation must not hide the remaining history. */}}return result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id));});},
  get(value){let conversationId;try{conversationId=id(value);}catch{return Promise.reject(error('invalid'));}return serial(async()=>{const source=await use('readonly',store=>store.get(conversationId));if(source===undefined)return null;try{return normalizeConversation(source);}catch{throw error('corrupt');}});},
  remove(value){let conversationId;try{conversationId=id(value);}catch{return Promise.reject(error('invalid'));}return serial(()=>use('readwrite',store=>store.delete(conversationId)));},
  clear(){return serial(()=>use('readwrite',store=>store.clear()));},
  close(){closed=true;},
 });
}
