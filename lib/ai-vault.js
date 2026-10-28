import{validateAIConfig}from'./ai-client.js';

const DATABASE='qingji-ai-credentials-v1',STORE='credentials',ENTRY='current',VERSION=1;
const MESSAGES={unsupported:'当前浏览器不支持本机加密保存密钥，请使用仅本次有效的密钥。',config:'接口地址不适合保存凭据，请检查 HTTPS 基础地址。',key:'密钥格式不正确，请在密钥输入框重新填写。',storage:'浏览器未能读写本机密钥，请检查存储权限与可用空间。',blocked:'本机密钥存储暂被其他页面占用，请关闭重复页面后重试。',decrypt:'本机密钥无法解密，请重新填写并保存密钥。',corrupt:'本机密钥数据不完整，请清除已保存密钥后重新设置。',crypto:'本机密钥加密失败，本次未保存密钥。'};
let pending=Promise.resolve();
function error(code){const value=new Error(MESSAGES[code]||MESSAGES.storage);value.name='AICredentialError';value.code=code;return value;}
function serial(task){const operation=pending.then(task,task);pending=operation.catch(()=>{});return operation;}
function base(value){try{return validateAIConfig({baseUrl:value,model:'credential-check',mode:'text'}).baseUrl;}catch{throw error('config');}}
function secret(value){if(typeof value!=='string'||!/^[\x21-\x7E]{8,2048}$/.test(value.trim()))throw error('key');return value.trim();}
function cryptoSupport(){if(globalThis.isSecureContext===false||!globalThis.crypto?.subtle||typeof globalThis.crypto.getRandomValues!=='function')throw error('unsupported');return globalThis.crypto;}
const aad=value=>new TextEncoder().encode('qingji-ai-credentials-v1\n'+value);

function openVault(){
 if(!globalThis.indexedDB)throw error('unsupported');
 return new Promise((resolve,reject)=>{
  let request,settled=false;
  const fail=code=>{if(settled)return;settled=true;clearTimeout(timer);reject(error(code));};
  const timer=setTimeout(()=>fail('blocked'),5000);
  try{request=globalThis.indexedDB.open(DATABASE,VERSION);}catch{fail('storage');return;}
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
  request.onblocked=()=>fail('blocked');request.onerror=()=>fail('storage');
  request.onsuccess=()=>{const db=request.result;if(settled){db.close();return;}settled=true;clearTimeout(timer);db.onversionchange=()=>db.close();resolve(db);};
 });
}
function transact(db,mode,operation){
 return new Promise((resolve,reject)=>{
  let tx,request,result,settled=false;
  const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);reject(error('storage'));};
  const timer=setTimeout(()=>{try{tx?.abort();}catch{}fail();},5000);
  try{
   tx=db.transaction(STORE,mode);request=operation(tx.objectStore(STORE));
   request.onsuccess=()=>{result=request.result;};request.onerror=fail;tx.onerror=fail;tx.onabort=fail;
   tx.oncomplete=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result);};
  }catch{try{tx?.abort();}catch{}fail();}
 });
}

/** Optional device persistence only, invoked after the user chooses to remember
 * a credential. The CryptoKey is nonextractable, but any trusted-origin script
 * can still decrypt through WebCrypto. This is not protection against XSS,
 * malicious same-origin updates, browser extensions or an unlocked device.
 * No ledger, localStorage, backup, network request or plaintext fallback. */
export function storeCredential({baseUrl,apiKey}={}){
 return serial(async()=>{
  const selectedBase=base(baseUrl),selectedKey=secret(apiKey),engine=cryptoSupport();
  try{if(decodeURIComponent(selectedBase).includes(selectedKey))throw error('config');}catch(cause){if(cause?.name==='AICredentialError')throw cause;throw error('config');}
  let cryptoKey,iv,ciphertext;
  try{
   cryptoKey=await engine.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
   iv=engine.getRandomValues(new Uint8Array(12));const bytes=new TextEncoder().encode(selectedKey);
   try{ciphertext=await engine.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(selectedBase),tagLength:128},cryptoKey,bytes);}finally{bytes.fill(0);}
  }catch{throw error('crypto');}
  const db=await openVault();
  try{await transact(db,'readwrite',store=>store.put({version:VERSION,baseUrl:selectedBase,cryptoKey,iv,ciphertext},ENTRY));}finally{db.close();}
 });
}
export function loadCredential(baseUrl){
 return serial(async()=>{
  const selectedBase=base(baseUrl),engine=cryptoSupport(),db=await openVault();let record;
  try{record=await transact(db,'readonly',store=>store.get(ENTRY));}finally{db.close();}
  if(record===undefined||record===null)return null;
  if(record.baseUrl!==selectedBase)return null;
  const key=record.cryptoKey;
  if(record.version!==VERSION||typeof globalThis.CryptoKey!=='function'||!(key instanceof globalThis.CryptoKey)||key.type!=='secret'||key.extractable!==false||key.algorithm?.name!=='AES-GCM'||key.algorithm?.length!==256||!key.usages.includes('decrypt')||!(record.iv instanceof Uint8Array)||record.iv.byteLength!==12||!(record.ciphertext instanceof ArrayBuffer)||record.ciphertext.byteLength<24||record.ciphertext.byteLength>2064)throw error('corrupt');
  let bytes;
  try{bytes=new Uint8Array(await engine.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:aad(selectedBase),tagLength:128},key,record.ciphertext));return secret(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw error('decrypt');}finally{bytes?.fill(0);}
 });
}
export function clearCredential(){
 return serial(async()=>{const db=await openVault();try{await transact(db,'readwrite',store=>store.delete(ENTRY));}finally{db.close();}});
}
