const DATABASE='qingji-pocket-local';
const STORE='ledger';
export class StorageConflictError extends Error{constructor(){super('另一页面已修改账本。已重新读取，请再试一次。');this.name='StorageConflictError';}}
export class LocalLedger {
  constructor(){this.db=null;}
  async open(){
    if(!globalThis.indexedDB)throw new Error('当前浏览器不支持本机保存，请换 Safari 普通浏览模式打开。');
    this.db=await new Promise((resolve,reject)=>{const req=indexedDB.open(DATABASE,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('其他页面正在占用账本，请关闭重复页面后重试。'));req.onsuccess=()=>resolve(req.result);});
    this.db.onversionchange=()=>{this.db.close();this.db=null;};
    let state=await this.read();
    if(!state){const initial=createState();try{await this.write(initial,null);state=initial;}catch(error){if(error instanceof StorageConflictError)state=await this.read();else throw error;}}
    return state;
  }
  async read(){if(!this.db)throw new Error('账本尚未打开');return new Promise((resolve,reject)=>{const tx=this.db.transaction(STORE,'readonly');const request=tx.objectStore(STORE).get('state');request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});}
  async write(state,expectedRevision){
    if(!this.db)throw new Error('当前账本不可保存。请先导出你能看到的记录，并重新打开页面。');
    return new Promise((resolve,reject)=>{const tx=this.db.transaction(STORE,'readwrite');const store=tx.objectStore(STORE);const read=store.get('state');let conflict=false;read.onsuccess=()=>{const current=read.result;if(expectedRevision===null?!!current:((current?.revision??null)!==expectedRevision)){conflict=true;tx.abort();return;}store.put(state,'state');};tx.oncomplete=()=>resolve(state);tx.onerror=()=>reject(tx.error||new Error('保存失败，请检查可用空间'));tx.onabort=()=>reject(conflict?new StorageConflictError():(tx.error||new Error('保存已取消')));});
  }
}
export function randomToken(){const b=new Uint8Array(24);crypto.getRandomValues(b);return Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');}
export function createState(){return{schemaVersion:1,revision:0,ledgerId:crypto.randomUUID(),sourceToken:randomToken(),records:[],rules:{},budgets:{},lastBackupAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};}
