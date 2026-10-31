import{AI_LIMITS,validateAIConfig,buildAIPreview,redactAIText}from'./ai-client.js';
import{requestConversationInWorker,chatRequestError}from'./ai-worker-client.js';
import{createAISettings}from'./ai-settings-ui.js';

const CONFIG_KEY='qingji-ai-settings-v1';
const $=id=>document.getElementById(id);
const fieldNames={merchant:'商户 / 对方',category:'分类',purpose:'用途'};
const errors={VISION:'所选模型只支持文字，不能直接识别图片。请自行选择支持图片的模型，或改用预览文字。本次图片尚未发送。',CONFIG:'接口配置不完整或地址不安全，请检查设置。',AUTH:'密钥未通过验证，请检查后重新填写。',RATE_LIMIT:'服务商限制了本次请求或账户额度不足，请查看自己的服务账户。',NETWORK:'未能连接接口，可能是网络或跨域限制。请确认服务允许网页直连；不要改用来历不明的公共转发。',TIMEOUT:'本次等待超时，没有自动重试。服务商仍可能已经计费。',ABORTED:'已取消等待，没有自动重试。已发出的请求仍可能被服务商处理和计费。',RESPONSE:'返回内容不能安全使用，请保留原来的核对信息。',IMAGE:'裁剪图未准备好，请重新预览。'};

// Active secrets stay in this closure. Optional remembered credentials live in
// the separate encrypted vault, never in ledger preferences or backups.
export function createAIAssistant({getContext,onApply}){
 let config=null,apiKey='',activeWorker=null,activeRequest=0,photoURL='',photo=null,imageDataUrl='',imageRun=0,previewRun=0,result=null,previewConfig=null;
 let settingsUI=null;
 const chatControllers=new Set();let lastSessionSignature='',lastSessionKey='';
 function getSessionInfo(){return Object.freeze({configured:Boolean(config),hasKey:Boolean(apiKey),...(config?{baseUrl:config.baseUrl,endpoint:config.endpoint,model:config.model,mode:config.mode}:{})});}
 function notifySession(reason='changed'){const info=getSessionInfo(),signature=JSON.stringify(info);if(reason==='changed'&&signature===lastSessionSignature&&apiKey===lastSessionKey)return;lastSessionSignature=signature;lastSessionKey=apiKey;window.dispatchEvent(new CustomEvent('qingji-ai-session',{detail:{...info,reason}}));}
 function cancelConversationRequests(){for(const controller of chatControllers)controller.abort();chatControllers.clear();}
 function setSessionKey(value){settingsUI?.cancel();const next=typeof value==='string'?value.trim():'';if(!/^[\x21-\x7E]{8,2048}$/.test(next))throw chatRequestError('AUTH');let endpoint='';try{if(config)endpoint=decodeURIComponent(config.endpoint);}catch{throw chatRequestError('CONFIG');}if(config&&(endpoint.includes(next)||config.model.includes(next)))throw chatRequestError('CONFIG');if(apiKey!==next){cancelConversationRequests();cancelRequest(false);}apiKey=next;keyStatus();return true;}
 async function requestChat({payload,imageDataUrl,imageDataUrls,signal,expectedService}={}){
  if(!config)throw chatRequestError('CONFIG');if(!apiKey)throw chatRequestError('AUTH');
  if(!expectedService||['endpoint','model','mode'].some(field=>expectedService[field]!==config[field]))throw chatRequestError('CONFIG');
  if(signal?.aborted)throw chatRequestError('ABORTED');
  const selected={baseUrl:config.baseUrl,model:config.model,mode:imageDataUrl||(Array.isArray(imageDataUrls)&&imageDataUrls.length)?'image':'text'};
  const controller=new AbortController(),abort=()=>controller.abort();chatControllers.add(controller);signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)controller.abort();
  try{return await requestConversationInWorker({config:selected,apiKey,payload,imageDataUrl,imageDataUrls,signal:controller.signal});}
  finally{chatControllers.delete(controller);signal?.removeEventListener('abort',abort);}
 }
 try{const saved=JSON.parse(localStorage.getItem(CONFIG_KEY)||'null');if(saved)config=validateAIConfig(saved);}catch{}
 $('ai-review').innerHTML=`<details id="ai-assist" class="ai-assist"><summary>AI 补全商户 · 可选</summary><p class="micro-copy">本地读得不准时再用。先预览要发的内容，AI 的建议由你选择采用；金额、日期和收支类型保持当前核对值。</p><p id="ai-review-config" class="micro-copy"></p><button id="ai-prepare" class="button secondary" type="button">预览本次 AI 请求</button><div id="ai-preview" hidden><p id="ai-target" class="ai-target"></p><label class="form-label">将要发送的文字，可删除或修改<textarea id="ai-payload" rows="7" maxlength="12000" autocomplete="off" spellcheck="false"></textarea></label><p class="micro-copy">已尽量移除账号、单号等内容，仍请自行检查。只发送这里显示的文字，不发送整本账。</p><div id="ai-image-section" hidden><p class="form-label">将要发送的裁剪图</p><img id="ai-image-preview" alt="将向接口发送的本次裁剪图"><p class="micro-copy">请保留店名等必要区域。裁剪图可能仍含隐私信息；下面看到的这张图就是发送的图片。</p><details class="ai-crop"><summary>调整裁剪范围</summary><div class="ai-crop-grid"><label>上边 %<input id="ai-crop-top" type="number" inputmode="numeric" min="0" max="99" value="10"></label><label>下边 %<input id="ai-crop-bottom" type="number" inputmode="numeric" min="1" max="100" value="55"></label><label>左边 %<input id="ai-crop-left" type="number" inputmode="numeric" min="0" max="99" value="0"></label><label>右边 %<input id="ai-crop-right" type="number" inputmode="numeric" min="1" max="100" value="100"></label></div></details></div><label id="ai-session-key-row" class="form-label">本次 API 密钥<input id="ai-session-key" type="password" placeholder="密钥仅在当前页面暂存" autocomplete="off" spellcheck="false" maxlength="2048"></label><label class="check-label ai-consent"><input id="ai-consent" type="checkbox">我确认向上面显示的接口发送这些内容，并接受服务商可能产生的费用。</label><div class="button-row"><button id="ai-send" class="button primary" type="button" disabled>确认发送，获取建议</button><button id="ai-cancel" class="text-button" type="button" hidden>取消等待</button></div></div><p id="ai-status" class="micro-copy" role="status" aria-live="polite"></p><div id="ai-result" hidden><p class="micro-copy">AI 建议，请对照截图。点“采用”只填入核对页，最后仍需“确认记下”。</p><div id="ai-result-fields"></div><p id="ai-result-reason" class="micro-copy"></p></div></details>`;
 function message(text){$('ai-status').textContent=text;}
 function keyStatus(note=''){if(note)settingsUI?.setStatus(note);settingsUI?.refreshKeyState();$('ai-session-key-row').hidden=Boolean(apiKey);syncSend();notifySession();}
 function describeConfig(){$('ai-review-config').textContent=config?`当前方式：${config.mode==='image'?'文字和裁剪图':'只发文字'} · ${new URL(config.endpoint).hostname} · ${config.model}`:'先在“设置 → AI 接口”填写地址、模型和密钥。本地识别照常可用。';$('ai-prepare').disabled=!config;}
 function syncSend(){const imageReady=previewConfig?.mode!=='image'||Boolean(imageDataUrl);$('ai-send').disabled=Boolean(activeWorker)||!previewConfig||!apiKey||!$('ai-consent').checked||!$('ai-payload').value.trim()||!imageReady;}
 function revokePhoto(){imageRun++;imageDataUrl='';photo=null;if(photoURL)URL.revokeObjectURL(photoURL);photoURL='';$('ai-image-preview').removeAttribute('src');}
 function cancelRequest(show=true){activeRequest++;if(activeWorker){activeWorker.terminate();activeWorker=null;if(show)message(errors.ABORTED);}$('ai-cancel').hidden=true;$('ai-prepare').disabled=!config;for(const input of[$('ai-payload'),$('ai-consent'),...document.querySelectorAll('.ai-crop input')])input.disabled=false;syncSend();}
 function clearReview(){previewRun++;cancelRequest(false);revokePhoto();previewConfig=null;result=null;$('ai-preview').hidden=true;$('ai-result').hidden=true;$('ai-payload').value='';$('ai-session-key').value='';$('ai-consent').checked=false;$('ai-assist').open=false;message('');}
 function forgetKey(){settingsUI?.cancel();cancelRequest(false);cancelConversationRequests();apiKey='';$('ai-api-key').value='';$('ai-session-key').value='';$('ai-consent').checked=false;keyStatus('本次密钥已清除；保存的账目没有变化。');}
 function captureKey(input){if(input.value){settingsUI?.cancel();apiKey=input.value.trim();input.value='';}keyStatus();}
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
  const payload=$('ai-payload').value.trim();if(payload.length>12000){message('预览文字过长，请保留本次必要内容，最多 12,000 字符。');return;}if(!payload||payload.includes(apiKey)){message('预览内容为空或包含本次密钥，请修改后再发送。');return;}
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
 $('ai-session-key').addEventListener('blur',()=>captureKey($('ai-session-key')));
 $('ai-session-key').addEventListener('input',()=>{$('ai-consent').checked=false;});
 $('ai-prepare').addEventListener('click',preparePreview);
 $('ai-payload').addEventListener('input',()=>{$('ai-consent').checked=false;syncSend();});
 $('ai-consent').addEventListener('change',()=>{captureKey($('ai-session-key'));syncSend();});
 for(const input of document.querySelectorAll('.ai-crop input'))input.addEventListener('input',cropImage);
 $('ai-send').addEventListener('click',send);$('ai-cancel').addEventListener('click',()=>cancelRequest());
 $('ai-result-fields').addEventListener('click',event=>{const button=event.target.closest('[data-ai-apply]');if(!button||!result)return;const field=button.dataset.aiApply;if(!Object.hasOwn(fieldNames,field)||!result[field])return;onApply(field,result[field]);button.textContent='已填入';message('已填入核对页，还没有保存。金额和日期请照常核对。');});
 settingsUI=createAISettings({host:$('ai-settings'),getConfig:()=>config,getKey:()=>apiKey,onApply:(next,key)=>{cancelRequest(false);cancelConversationRequests();config=next;apiKey=key;clearReview();describeConfig();keyStatus();},onInvalidate:targetChanged=>{cancelRequest(false);cancelConversationRequests();if(targetChanged){config=null;apiKey='';$('ai-session-key').value='';}clearReview();describeConfig();keyStatus();notifySession('editing');}});
 window.addEventListener('pagehide',()=>{forgetKey();clearReview();});
 keyStatus();describeConfig();
 function sanitizeHistoryText(value){const text=typeof value==='string'?value:'';return redactAIText(apiKey?text.split(apiKey).join('[已隐藏密钥]'):text,6000);}
 return{clearReview,refreshReview(){clearReview();$('ai-review').hidden=!getContext()?.draft;describeConfig();keyStatus();},isBusy:()=>Boolean(activeWorker)||Boolean(settingsUI?.isBusy()),hasUnsavedWork:()=>Boolean(settingsUI?.hasUnsavedWork()),forgetKey,getSessionInfo,setSessionKey,requestChat,sanitizeHistoryText};
}
