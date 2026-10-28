import{AI_LIMITS,validateAIConfig,buildAIPreview}from'./ai-client.js';
import{requestConversationInWorker,chatRequestError}from'./ai-worker-client.js';

const CONFIG_KEY='qingji-ai-settings-v1';
const $=id=>document.getElementById(id);
const fieldNames={merchant:'商户 / 对方',category:'分类',purpose:'用途'};
const errors={CONFIG:'接口配置不完整或地址不安全，请检查设置。',AUTH:'密钥未通过验证，请检查后重新填写。',RATE_LIMIT:'服务商限制了本次请求或账户额度不足，请查看自己的服务账户。',NETWORK:'未能连接接口，可能是网络或跨域限制。请确认服务允许网页直连；不要改用来历不明的公共转发。',TIMEOUT:'本次等待超时，没有自动重试。服务商仍可能已经计费。',ABORTED:'已取消等待，没有自动重试。已发出的请求仍可能被服务商处理和计费。',RESPONSE:'返回内容不能安全使用，请保留原来的核对信息。',IMAGE:'裁剪图未准备好，请重新预览。'};

// Secrets stay in this module's live closure. Preferences contain no key and
// are deliberately separate from the ledger and its export/backup schema.
export function createAIAssistant({getContext,onApply}){
 let config=null,apiKey='',activeWorker=null,activeRequest=0,photoURL='',photo=null,imageDataUrl='',imageRun=0,previewRun=0,result=null,previewConfig=null;
 let settingsDirty=false;
 const chatControllers=new Set();let lastSessionSignature='',lastSessionKey='';
 function getSessionInfo(){return Object.freeze({configured:Boolean(config),hasKey:Boolean(apiKey),...(config?{baseUrl:config.baseUrl,endpoint:config.endpoint,model:config.model,mode:config.mode}:{})});}
 function notifySession(reason='changed'){const info=getSessionInfo(),signature=JSON.stringify(info);if(reason==='changed'&&signature===lastSessionSignature&&apiKey===lastSessionKey)return;lastSessionSignature=signature;lastSessionKey=apiKey;window.dispatchEvent(new CustomEvent('qingji-ai-session',{detail:{...info,reason}}));}
 function cancelConversationRequests(){for(const controller of chatControllers)controller.abort();chatControllers.clear();}
 function setSessionKey(value){const next=typeof value==='string'?value.trim():'';if(!/^[\x21-\x7E]{8,2048}$/.test(next))throw chatRequestError('AUTH');let endpoint='';try{if(config)endpoint=decodeURIComponent(config.endpoint);}catch{throw chatRequestError('CONFIG');}if(config&&(endpoint.includes(next)||config.model.includes(next)))throw chatRequestError('CONFIG');if(apiKey!==next){cancelConversationRequests();cancelRequest(false);}apiKey=next;keyStatus();return true;}
 async function requestChat({payload,imageDataUrl,signal,expectedService}={}){
  if(!config)throw chatRequestError('CONFIG');if(!apiKey)throw chatRequestError('AUTH');
  if(!expectedService||['endpoint','model','mode'].some(field=>expectedService[field]!==config[field]))throw chatRequestError('CONFIG');
  if(signal?.aborted)throw chatRequestError('ABORTED');
  const selected={baseUrl:config.baseUrl,model:config.model,mode:config.mode};
  const controller=new AbortController(),abort=()=>controller.abort();chatControllers.add(controller);signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)controller.abort();
  try{return await requestConversationInWorker({config:selected,apiKey,payload,imageDataUrl,signal:controller.signal});}
  finally{chatControllers.delete(controller);signal?.removeEventListener('abort',abort);}
 }
 try{const saved=JSON.parse(localStorage.getItem(CONFIG_KEY)||'null');if(saved)config=validateAIConfig(saved);}catch{}
 $('ai-settings').innerHTML=`<div class="setting-heading"><h2>AI 接口 · 自选</h2><span class="subtle-tag">默认不联网</span></div><p>本地记账免费。需要更细的商户判断时，可以使用自己的接口；其他人各填自己的地址和密钥。服务商可能收取调用费。</p><form id="ai-config-form" class="ai-config"><button id="ai-deepseek-preset" class="text-button" type="button">填入 DeepSeek 示例</button><label class="form-label">接口基础地址<input id="ai-base-url" type="url" placeholder="https://你的服务地址/v1" autocomplete="off" spellcheck="false" maxlength="500"></label><label class="form-label">模型名称<input id="ai-model" type="text" placeholder="填写服务商提供的模型名" autocomplete="off" spellcheck="false" maxlength="100"></label><label class="form-label">发送方式<select id="ai-mode"><option value="text">文字提取 · 只发预览文字</option><option value="image">识图提取 · 加上本次裁剪图</option></select></label><p class="micro-copy">使用 Chat Completions 兼容接口；识图需要模型支持图片。填地址和保存配置不会发起调用。密钥请填下面，不要放在地址里。</p><label class="form-label">API 密钥<input id="ai-api-key" type="password" placeholder="只在当前页面暂存" autocomplete="off" spellcheck="false" maxlength="2048"></label><label class="check-label"><input id="ai-remember-config" type="checkbox" checked>记住地址和模型，不保存密钥</label><div class="button-row"><button id="ai-save-config" type="submit" class="button secondary">保存配置</button><button id="ai-forget-key" type="button" class="text-button">忘记本次密钥</button><button id="ai-reset-config" type="button" class="text-button">清除接口配置</button></div><p id="ai-config-status" class="micro-copy" role="status"></p></form><p class="micro-copy">密钥不进入账本、备份或程序代码；刷新或离开页面后需重填。你点“确认发送”后，服务商会收到这一次预览的内容和用于验证的密钥。网页版无法保证密钥绝对安全，请使用可信接口、谨慎授权扩展，并在服务商处设置可用的额度限制。</p><a class="text-link" href="./help.html#ai">接口用法和数据范围 ↗</a>`;
 $('ai-review').innerHTML=`<details id="ai-assist" class="ai-assist"><summary>AI 补全商户 · 可选</summary><p class="micro-copy">本地读得不准时再用。先预览要发的内容，AI 的建议由你选择采用；金额、日期和收支类型保持当前核对值。</p><p id="ai-review-config" class="micro-copy"></p><button id="ai-prepare" class="button secondary" type="button">预览本次 AI 请求</button><div id="ai-preview" hidden><p id="ai-target" class="ai-target"></p><label class="form-label">将要发送的文字，可删除或修改<textarea id="ai-payload" rows="7" maxlength="12000" autocomplete="off" spellcheck="false"></textarea></label><p class="micro-copy">已尽量移除账号、单号等内容，仍请自行检查。只发送这里显示的文字，不发送整本账。</p><div id="ai-image-section" hidden><p class="form-label">将要发送的裁剪图</p><img id="ai-image-preview" alt="将向接口发送的本次裁剪图"><p class="micro-copy">请保留店名等必要区域。裁剪图可能仍含隐私信息；下面看到的这张图就是发送的图片。</p><details class="ai-crop"><summary>调整裁剪范围</summary><div class="ai-crop-grid"><label>上边 %<input id="ai-crop-top" type="number" inputmode="numeric" min="0" max="99" value="10"></label><label>下边 %<input id="ai-crop-bottom" type="number" inputmode="numeric" min="1" max="100" value="55"></label><label>左边 %<input id="ai-crop-left" type="number" inputmode="numeric" min="0" max="99" value="0"></label><label>右边 %<input id="ai-crop-right" type="number" inputmode="numeric" min="1" max="100" value="100"></label></div></details></div><label id="ai-session-key-row" class="form-label">本次 API 密钥<input id="ai-session-key" type="password" placeholder="密钥仅在当前页面暂存" autocomplete="off" spellcheck="false" maxlength="2048"></label><label class="check-label ai-consent"><input id="ai-consent" type="checkbox">我确认向上面显示的接口发送这些内容，并接受服务商可能产生的费用。</label><div class="button-row"><button id="ai-send" class="button primary" type="button" disabled>确认发送，获取建议</button><button id="ai-cancel" class="text-button" type="button" hidden>取消等待</button></div></div><p id="ai-status" class="micro-copy" role="status" aria-live="polite"></p><div id="ai-result" hidden><p class="micro-copy">AI 建议，请对照截图。点“采用”只填入核对页，最后仍需“确认记下”。</p><div id="ai-result-fields"></div><p id="ai-result-reason" class="micro-copy"></p></div></details>`;
 if(config){$('ai-base-url').value=config.baseUrl;$('ai-model').value=config.model;$('ai-mode').value=config.mode;}
 function message(text){$('ai-status').textContent=text;}
 function keyStatus(note=''){$('ai-config-status').textContent=note||(!config?'尚未配置；本地记账可直接使用。':apiKey?'配置已就绪，密钥只在本次页面暂存，调用由你主动发送。':'地址和模型已填写；调用前还需提供本次密钥。');$('ai-forget-key').disabled=!apiKey;$('ai-session-key-row').hidden=Boolean(apiKey);syncSend();notifySession();}
 function describeConfig(){$('ai-review-config').textContent=config?`当前方式：${config.mode==='image'?'文字和裁剪图':'只发文字'} · ${new URL(config.endpoint).hostname} · ${config.model}`:'先在“设置 → AI 接口”填写地址、模型和密钥。本地识别照常可用。';$('ai-prepare').disabled=!config;}
 function syncSend(){const imageReady=previewConfig?.mode!=='image'||Boolean(imageDataUrl);$('ai-send').disabled=Boolean(activeWorker)||!previewConfig||!apiKey||!$('ai-consent').checked||!$('ai-payload').value.trim()||!imageReady;}
 function revokePhoto(){imageRun++;imageDataUrl='';photo=null;if(photoURL)URL.revokeObjectURL(photoURL);photoURL='';$('ai-image-preview').removeAttribute('src');}
 function cancelRequest(show=true){activeRequest++;if(activeWorker){activeWorker.terminate();activeWorker=null;if(show)message(errors.ABORTED);}$('ai-cancel').hidden=true;$('ai-prepare').disabled=!config;for(const input of[$('ai-payload'),$('ai-consent'),...document.querySelectorAll('.ai-crop input')])input.disabled=false;syncSend();}
 function clearReview(){previewRun++;cancelRequest(false);revokePhoto();previewConfig=null;result=null;$('ai-preview').hidden=true;$('ai-result').hidden=true;$('ai-payload').value='';$('ai-session-key').value='';$('ai-consent').checked=false;$('ai-assist').open=false;message('');}
 function forgetKey(){cancelRequest(false);cancelConversationRequests();apiKey='';$('ai-api-key').value='';$('ai-session-key').value='';$('ai-consent').checked=false;keyStatus('本次密钥已清除；保存的账目没有变化。');}
 function captureKey(input){if(input.value){apiKey=input.value.trim();input.value='';}keyStatus();}
 async function cropImage(){
  const run=++imageRun;imageDataUrl='';$('ai-consent').checked=false;$('ai-image-preview').removeAttribute('src');syncSend();
  if(!photo)return;
  const top=Number($('ai-crop-top').value),bottom=Number($('ai-crop-bottom').value),left=Number($('ai-crop-left').value),right=Number($('ai-crop-right').value);
  if(![top,bottom,left,right].every(Number.isFinite)||top<0||bottom>100||left<0||right>100||bottom-top<2||right-left<2){message('裁剪范围至少保留 2%，下边要大于上边，右边要大于左边。');return;}
  try{const sx=Math.floor(photo.naturalWidth*left/100),sy=Math.floor(photo.naturalHeight*top/100),sw=Math.floor(photo.naturalWidth*(right-left)/100),sh=Math.floor(photo.naturalHeight*(bottom-top)/100);const scale=Math.min(1,1600/Math.max(sw,sh),Math.sqrt(1600000/(sw*sh)));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(sw*scale));canvas.height=Math.max(1,Math.round(sh*scale));const context=canvas.getContext('2d');if(!context)throw new Error();context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(photo,sx,sy,sw,sh,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',0.88);canvas.width=canvas.height=1;if(run!==imageRun)return;if(data.length>4*1024*1024)throw new Error();imageDataUrl=data;$('ai-image-preview').src=data;message('预览在本机生成，尚未发送。请检查文字和裁剪图，再勾选确认。');syncSend();}catch{if(run===imageRun)message('这张图片暂时无法裁剪，请改用文字方式或重新选图。');}
 }
 async function preparePreview(){
  const prepareId=++previewRun;
  cancelRequest(false);revokePhoto();result=null;$('ai-result').hidden=true;$('ai-consent').checked=false;
  try{previewConfig=validateAIConfig(config);const context=getContext();if(!context?.draft)throw new Error();$('ai-payload').value=buildAIPreview({text:context.text,candidates:context.candidates,draft:context.draft});$('ai-target').textContent=`发送到：${previewConfig.endpoint}\n模型：${previewConfig.model}\n方式：${previewConfig.mode==='image'?'文字 + 下方裁剪图':'仅上方预览文字，不发图片'}`;$('ai-preview').hidden=false;$('ai-image-section').hidden=previewConfig.mode!=='image';keyStatus();message('预览已在本机生成，尚未发送。');
   if(previewConfig.mode==='image'){
    if(!(context.imageFile instanceof Blob)){message('本次没有可用的原图，请重新选择截图，或在设置改成“文字提取”。');return;}
    if(context.imageFile.size>20*1024*1024)throw new Error();photoURL=URL.createObjectURL(context.imageFile);const sourceURL=photoURL;const image=new Image();image.decoding='async';image.src=sourceURL;await image.decode();if(prepareId!==previewRun||photoURL!==sourceURL)return;if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>32000000)throw new Error();photo=image;await cropImage();
   }
   syncSend();
  }catch{if(prepareId!==previewRun)return;previewConfig=null;revokePhoto();message('暂时无法准备请求，请检查接口配置和本次识别内容。');syncSend();}
 }
 function showResult(value){
  result=value;$('ai-result-fields').replaceChildren();
  for(const field of['merchant','category','purpose']){const row=document.createElement('div');row.className='ai-result-row';const text=document.createElement('p'),label=document.createElement('small'),strong=document.createElement('strong');label.textContent=fieldNames[field];strong.id='ai-result-'+field;strong.textContent=result[field]||'未确定';text.append(label,strong);const apply=document.createElement('button');apply.type='button';apply.className='text-button';apply.dataset.aiApply=field;apply.textContent='采用';apply.disabled=!result[field];row.append(text,apply);$('ai-result-fields').append(row);}
  $('ai-result-reason').textContent=result.reason||'仍需对照截图确认。';$('ai-result').hidden=false;
 }
 function requestError(data){return errors[data?.code]||errors.RESPONSE;}
 function send(){
  captureKey($('ai-session-key'));if(activeWorker||!previewConfig||!apiKey||!$('ai-consent').checked)return;
  if(!navigator.onLine){message('当前离线，AI 需要网络。本地识别和已填草稿仍可使用。');return;}
  if(previewConfig.mode==='image'&&!imageDataUrl){message(errors.IMAGE);return;}
  const payload=$('ai-payload').value.trim();if(payload.length>AI_LIMITS.previewChars){message('预览文字过长，请保留本次必要内容，最多 12,000 字符。');return;}if(!payload||payload.includes(apiKey)){message('预览内容为空或包含本次密钥，请修改后再发送。');return;}
  const id=++activeRequest;try{activeWorker=new Worker(new URL('../ai-worker.js',import.meta.url),{type:'module',name:'qingji-ai-once'});}catch{message('当前浏览器无法开启安全请求任务，请使用新版 Safari。');return;}
  $('ai-consent').checked=false;$('ai-cancel').hidden=false;$('ai-prepare').disabled=true;$('ai-result').hidden=true;
  for(const input of[$('ai-payload'),$('ai-consent'),...document.querySelectorAll('.ai-crop input')])input.disabled=true;
  syncSend();message('正在向你选择的接口发送这一次请求，请稍等。');
  const worker=activeWorker;let timer;
  const finish=()=>{clearTimeout(timer);worker.terminate();if(activeWorker===worker)activeWorker=null;$('ai-cancel').hidden=true;$('ai-prepare').disabled=!config;for(const input of[$('ai-payload'),$('ai-consent'),...document.querySelectorAll('.ai-crop input')])input.disabled=false;syncSend();};
  worker.onmessage=event=>{if(id!==activeRequest)return;const data=event.data;if(data?.type==='result'){finish();showResult(data.result);message('建议已返回，还没有填入或保存。请逐项选择是否采用。');}else if(data?.type==='error'){finish();message(requestError(data));}};
  worker.onerror=event=>{event.preventDefault();if(id!==activeRequest)return;finish();message(errors.NETWORK);};
  timer=setTimeout(()=>{if(id!==activeRequest)return;finish();message(errors.TIMEOUT);},47000);
  worker.postMessage({type:'extract',config:{baseUrl:previewConfig.baseUrl,model:previewConfig.model,mode:previewConfig.mode},apiKey,payload,...(previewConfig.mode==='image'?{imageDataUrl}:{})});
 }
 $('ai-config-form').addEventListener('input',()=>{settingsDirty=true;});
 $('ai-deepseek-preset').addEventListener('click',()=>{$('ai-base-url').value='https://api.deepseek.com';$('ai-model').value='deepseek-flash';$('ai-mode').value='image';settingsDirty=true;keyStatus('已填入 DeepSeek 识图示例，尚未连接。请核对模型和服务费用，再填写你自己的密钥并保存。');});
 $('ai-config-form').addEventListener('submit',event=>{event.preventDefault();try{const next=validateAIConfig({baseUrl:$('ai-base-url').value,model:$('ai-model').value,mode:$('ai-mode').value});const knownKeys=[apiKey,$('ai-api-key').value.trim()].filter(Boolean);const address=decodeURIComponent(next.endpoint);if(knownKeys.some(key=>address.includes(key)||next.model.includes(key))){if(knownKeys.some(key=>address.includes(key)))$('ai-base-url').value='';if(knownKeys.some(key=>next.model.includes(key)))$('ai-model').value='';throw new Error();}const changed=config&&next.endpoint!==config.endpoint;if($('ai-api-key').value)captureKey($('ai-api-key'));else if(changed)apiKey='';cancelRequest(false);cancelConversationRequests();config=next;clearReview();settingsDirty=false;let stored=true;try{if($('ai-remember-config').checked)localStorage.setItem(CONFIG_KEY,JSON.stringify({baseUrl:config.baseUrl,model:config.model,mode:config.mode}));else localStorage.removeItem(CONFIG_KEY);}catch{stored=false;}describeConfig();keyStatus(stored?'配置已保存，尚未发起调用。'+(apiKey?'密钥仅在本次页面有效。':'调用前请填写本次密钥。'):'本次配置可用，但浏览器未能记住地址；关闭后需重填。');}catch{$('ai-api-key').value='';keyStatus('地址或模型不符合要求。请使用 HTTPS 公网服务地址，移除地址中的账号、密钥、查询参数；模型名需由服务商提供。');}});
 $('ai-forget-key').addEventListener('click',forgetKey);
 $('ai-reset-config').addEventListener('click',()=>{forgetKey();clearReview();config=null;settingsDirty=false;$('ai-base-url').value='';$('ai-model').value='';$('ai-mode').value='text';try{localStorage.removeItem(CONFIG_KEY);}catch{}describeConfig();keyStatus('接口配置与本次密钥已清除，本地账本没有变化。');});
 $('ai-session-key').addEventListener('blur',()=>captureKey($('ai-session-key')));
 $('ai-session-key').addEventListener('input',()=>{$('ai-consent').checked=false;});
 $('ai-prepare').addEventListener('click',preparePreview);
 $('ai-payload').addEventListener('input',()=>{$('ai-consent').checked=false;syncSend();});
 $('ai-consent').addEventListener('change',()=>{captureKey($('ai-session-key'));syncSend();});
 for(const input of document.querySelectorAll('.ai-crop input'))input.addEventListener('input',cropImage);
 $('ai-send').addEventListener('click',send);$('ai-cancel').addEventListener('click',()=>cancelRequest());
 $('ai-result-fields').addEventListener('click',event=>{const button=event.target.closest('[data-ai-apply]');if(!button||!result)return;const field=button.dataset.aiApply;if(!Object.hasOwn(fieldNames,field)||!result[field])return;onApply(field,result[field]);button.textContent='已填入';message('已填入核对页，还没有保存。金额和日期请照常核对。');});
 window.addEventListener('pagehide',()=>{forgetKey();clearReview();});
 keyStatus();describeConfig();
 return{clearReview,refreshReview(){clearReview();$('ai-review').hidden=!getContext()?.draft;describeConfig();keyStatus();},isBusy:()=>Boolean(activeWorker),hasUnsavedWork:()=>settingsDirty||Boolean($('ai-api-key').value),forgetKey,getSessionInfo,setSessionKey,requestChat};
}
