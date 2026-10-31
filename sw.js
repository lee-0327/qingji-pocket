const VERSION='qingji-shell-v1-pages-20261031-23';
const ROOT=new URL('./',self.location.href);
const SHELL=['./','index.html','styles.css','ui-v2.css','assets/qingji-cats-v2.png','lib/stickers.js','app.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','help.html','update.html','update.js','THIRD-PARTY-NOTICES.txt','lib/core.js','lib/data.js','lib/storage.js','lib/icons.js','lib/importer.js','lib/ocr.js','lib/bill-file.js','lib/updates.js','lib/ai-client.js','lib/ai-capabilities.js','lib/ai-ui.js','lib/ai-providers.js','lib/ai-vault.js','lib/ai-settings-ui.js','lib/ai-settings-client.js','lib/ai-settings-worker.js','lib/ai-settings.css','lib/ai-chat-client.js','lib/ai-worker-client.js','lib/chat-ui.js','lib/chat-history.js','lib/chat-history-ui.js','lib/chat-history.css','lib/chat.css','lib/voice-input.js','lib/voice-ui.js','lib/voice.css','ai-worker.js','bill-worker.js','vendor/xlsx.full.min.js','vendor/tesseract/tesseract.min.js'].map(path=>new URL(path,ROOT).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(VERSION);try{await cache.addAll(SHELL.map(url=>new Request(url,{cache:'reload',credentials:'same-origin'})));}catch(error){await caches.delete(VERSION);throw error;}if(!self.registration.active)await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('qingji-shell-')&&key!==VERSION)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();if(event.data?.type==='GET_VERSION')event.ports?.[0]?.postMessage({version:VERSION});});
self.addEventListener('fetch',event=>{
 const request=event.request;const url=new URL(request.url);if(request.method!=='GET'||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname))return;
 event.respondWith((async()=>{const shell=await caches.open(VERSION);
 // The recovery entry must remain reachable even when the main app is old.
 // Its files use network first, with an offline page available for guidance.
 const updateFiles=['update.html','update.js','lib/updates.js'].map(path=>new URL(path,ROOT).pathname);
 if(updateFiles.includes(url.pathname)){try{const response=await fetch(new Request(request,{cache:'no-store'}));if(response.ok)return response;return(await shell.match(url.href))||response;}catch(error){const cached=await shell.match(url.href);if(cached)return cached;throw error;}}
 const fixed=SHELL.includes(url.href);if(fixed){const cached=await shell.match(url.href);if(cached)return cached;}
 // OCR's own cache is populated only after a size and SHA-256 check. Never
 // add network responses here: a corrupt resource must not become ready.
 if(url.pathname.includes('/vendor/tesseract/')||url.pathname.endsWith('/OCR-ASSETS.json')){const resource=await caches.match(request,{ignoreSearch:false});if(resource)return resource;}
 try{return await fetch(request);}catch(error){if(request.mode==='navigate'){const fallback=await shell.match(new URL('index.html',ROOT).href);if(fallback)return fallback;}throw error;}})());
});
