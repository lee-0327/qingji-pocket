const VERSION='qingji-shell-v1-pages-20261028-07';
const ROOT=new URL('./',self.location.href);
const SHELL=['./','index.html','styles.css','app.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','help.html','THIRD-PARTY-NOTICES.txt','lib/core.js','lib/data.js','lib/storage.js','lib/icons.js','lib/importer.js','lib/ocr.js','lib/bill-file.js','bill-worker.js','vendor/xlsx.full.min.js','vendor/tesseract/tesseract.min.js'].map(path=>new URL(path,ROOT).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(VERSION);try{await cache.addAll(SHELL.map(url=>new Request(url,{cache:'reload',credentials:'same-origin'})));}catch(error){await caches.delete(VERSION);throw error;}if(!self.registration.active)await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('qingji-shell-')&&key!==VERSION)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const request=event.request;const url=new URL(request.url);if(request.method!=='GET'||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname))return;
 event.respondWith((async()=>{const shell=await caches.open(VERSION);const fixed=SHELL.includes(url.href);if(fixed){const cached=await shell.match(url.href);if(cached)return cached;}
 // OCR's own cache is populated only after a size and SHA-256 check. Never
 // add network responses here: a corrupt resource must not become ready.
 if(url.pathname.includes('/vendor/tesseract/')||url.pathname.endsWith('/OCR-ASSETS.json')){const resource=await caches.match(request,{ignoreSearch:false});if(resource)return resource;}
 try{return await fetch(request);}catch(error){if(request.mode==='navigate'){const fallback=await shell.match(new URL('index.html',ROOT).href);if(fallback)return fallback;}throw error;}})());
});
