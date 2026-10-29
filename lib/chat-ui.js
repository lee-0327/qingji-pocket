import{formatMoney}from'./core.js';
import{validDate}from'./data.js';
import{recordSticker,sticker}from'./stickers.js';
import{icon}from'./icons.js';
import{buildChatPayload}from'./ai-chat-client.js';
import{createVoiceUI}from'./voice-ui.js';

const TYPES={expense:'支出',income:'收入',refund:'退款',transfer:'转账'};
const SAFE_ERRORS={CONFIG:'请先检查接口地址、模型和发送方式。',AUTH:'密钥未通过验证，请检查后重新填写。',RATE_LIMIT:'服务商提示额度或请求频率受限，请查看自己的服务账户。',NETWORK:'暂时连接不上接口，请检查网络和服务商是否允许网页跨域访问。',TIMEOUT:'等待超时，没有自动重试；服务商仍可能已经处理并计费。',ABORTED:'已取消等待，没有自动重试；已发出的请求仍可能被处理和计费。',RESPONSE:'返回内容无法安全整理成账单，请保留原输入再核对。',IMAGE:'图片还没有准备好，请重新检查预览。',SESSION:'接口或密钥已变化，请重新核对本次发送范围。'};
const newId=()=>globalThis.crypto?.randomUUID?.()||`chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const plainFields=['amountCents','type','date','merchant','category','purpose','channel','notes','currency','paymentState'];
function plainDraft(draft){const value={};for(const field of plainFields)value[field]=draft?.[field]??(field==='amountCents'?null:'');return value;}
function fingerprint(drafts){return JSON.stringify(drafts.map(plainDraft));}
function needsAttention(draft){return Boolean(draft.needsAttention)||!Number.isSafeInteger(draft.amountCents)||draft.amountCents<=0||draft.amountCents>99999999999||!draft.merchant?.trim()||/^(未知|其他|未识别商户|商户未知|商户待补)$/.test(draft.merchant.trim())||!validDate(draft.date)||draft.currency!=='CNY'||['uncertain','not_completed'].includes(draft.paymentState);}
function textNode(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;node.textContent=text;return node;}

/** Chat, input images and credentials are never persisted by this view. */
export function createChatUI({host,getService,setSessionKey,onConfigure,request,onSave,onEdit,onUndo,getUndoableId,getToday,getRecord}){
 let turns=[],busy=false,saving=false,savingOwner=null,controller=null,requestRun=0,serviceSignature='',serviceWasReady=false,active=false;
 let image=null,imageURL='',imageDataUrl='',imageThumb='',imageRun=0,imagePreparing=false;
 let payloadEdited=false,payloadSource='',voiceUI=null,pendingVoice=null,consentSignature='';
 const $=id=>host.querySelector('#'+id);
 host.innerHTML=`<div class="page-heading chat-heading"><div><p class="eyebrow">发一句话，或一张付款截图</p><h1>轻记 AI</h1></div><button id="chat-clear" type="button" class="text-button">新对话</button></div>
  <div class="chat-shell">
   <details id="chat-service-details" class="chat-service-details"><summary id="chat-service">先配置自己的 AI 接口</summary><div id="chat-key-row"><label for="chat-api-key">本次 API 密钥</label><div class="chat-key-input"><input id="chat-api-key" type="password" maxlength="2048" autocomplete="off" spellcheck="false" placeholder="只在当前页面暂存"><button id="chat-use-key" type="button" class="button secondary">本次使用</button></div></div><button id="chat-configure" type="button" class="text-button">设置接口</button><p id="chat-destination" class="micro-copy"></p><p class="micro-copy">只向选定接口发送本次文字、主动选取的图片和未记下的卡片。接口可能收费，整本账不会发送。</p></details>
   <details id="chat-options" class="chat-options"><summary id="chat-mode-label">自动记账 · 更多</summary><label class="check-label"><input id="chat-auto-save" type="checkbox" checked>信息明确的账单直接记下；疑似重复或缺信息时先核对</label><label class="check-label chat-consent"><input id="chat-consent" type="checkbox"><span id="chat-consent-text">允许本次对话向选定接口发送消息，可能产生费用。</span></label><details id="chat-payload-details" class="chat-payload-details"><summary>查看本次发送内容</summary><label for="chat-payload">可修改；图片按下方预览发送</label><textarea id="chat-payload" rows="4" maxlength="12000" autocomplete="off" spellcheck="false"></textarea></details><p class="micro-copy">已记下的账目可修改或撤销；对话只在本次打开时保留。</p></details>
   <div id="chat-messages" class="chat-messages" role="log" aria-label="本次记账对话" aria-live="polite" aria-relevant="additions"></div>
   <p id="chat-status" class="chat-status" role="status" aria-live="polite"></p>
   <form id="chat-form" class="chat-composer">
    <div id="chat-attachment" class="chat-attachment" hidden><img id="chat-image-preview" alt="本次待发送的账单图片"><span>待发送图片</span><button id="chat-remove-image" type="button" class="text-button">移除</button></div>
    <details id="chat-image-crop" hidden><summary>检查 / 裁剪图片</summary><p class="micro-copy">保留商户、实付金额和付款时间，裁掉不需要的隐私信息。</p><div class="chat-crop-grid"><label>上边 %<input id="chat-crop-top" type="number" inputmode="numeric" min="0" max="99" value="0"></label><label>下边 %<input id="chat-crop-bottom" type="number" inputmode="numeric" min="1" max="100" value="100"></label><label>左边 %<input id="chat-crop-left" type="number" inputmode="numeric" min="0" max="99" value="0"></label><label>右边 %<input id="chat-crop-right" type="number" inputmode="numeric" min="1" max="100" value="100"></label></div></details>
    <label class="sr-only" for="chat-input">消息</label><div class="chat-composer-actions"><textarea id="chat-input" maxlength="2000" rows="1" placeholder="发消息，或点 + 选账单图" autocomplete="off"></textarea><button id="chat-add-image" type="button" class="chat-image-button" aria-label="添加账单图片">${icon('plus')}</button><button id="chat-send" type="submit" class="button primary">发送</button><button id="chat-cancel" type="button" class="text-button" hidden>停止</button></div>
   </form>
  </div><input id="chat-file" type="file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden>
  <dialog id="chat-send-dialog" class="sheet-dialog small-dialog" aria-labelledby="chat-send-title"><h2 id="chat-send-title">开始这次 AI 对话</h2><p id="chat-send-target"></p><p>本次会话的消息和你主动选择的图片将发送到这个接口，服务商可能收费。自动记账开启时，信息明确的账单会直接保存在本机；有疑问的账单先核对。</p><img id="chat-send-image" alt="即将发送的图片" hidden><div class="dialog-actions"><button id="chat-send-dismiss" type="button" class="button secondary">先不发送</button><button id="chat-send-accept" type="button" class="button primary">同意并发送</button></div></dialog>
  <dialog id="chat-clear-dialog" class="sheet-dialog small-dialog"><h2>开始一段新对话？</h2><p>当前临时对话、图片和未记下的卡片会清除，已经保存的账目保留。</p><div class="dialog-actions"><button id="chat-clear-cancel" class="button secondary" type="button">继续这段</button><button id="chat-clear-confirm" class="button primary" type="button">开始新对话</button></div></dialog>`;

 function pendingCards(){return turns.flatMap(turn=>turn.cards||[]).filter(card=>card.state==='pending');}
 function allCards(){return turns.flatMap(turn=>turn.cards||[]);}
 function status(message='',kind=''){$('chat-status').textContent=message;$('chat-status').dataset.kind=kind;}
 function expectedService(){const service=getService()||{};return{endpoint:service.endpoint||'',model:service.model||'',mode:service.mode||'text'};}
 function refreshService({reset=false}={}){
  const service=getService()||{},signature=JSON.stringify(expectedService());
  if(reset||signature!==serviceSignature){$('chat-consent').checked=false;serviceSignature=signature;}
  let hostname='未配置';try{if(service.endpoint)hostname=new URL(service.endpoint).hostname;}catch{}
  $('chat-service').textContent=service.configured?`${hostname} · ${service.model}`:'先配置自己的 AI 接口';
  $('chat-destination').textContent=service.configured?`发送到：${service.endpoint}`:'进入设置，填写自己的 HTTPS 接口、模型和密钥后再使用。';
  $('chat-key-row').hidden=!service.configured||Boolean(service.hasKey);
  const ready=Boolean(service.configured&&service.hasKey);
  if(ready&&!serviceWasReady)$('chat-service-details').open=false;
  serviceWasReady=ready;
  $('chat-consent-text').textContent=service.configured?`同意本次对话向 ${hostname} 发送上述内容，可能产生费用。`:'配置后，确认本次对话的发送范围与费用。';
  syncControls();
 }
 function updatePayload(){
  if(busy)return;
  try{payloadSource=buildChatPayload({text:$('chat-input').value,currentDrafts:pendingCards().map(card=>card.draft),referenceDate:getToday(),hasImage:Boolean(imageDataUrl)});$('chat-payload').value=payloadSource;payloadEdited=false;}catch{payloadSource='';$('chat-payload').value='';payloadEdited=false;}
  syncControls();
 }
 function syncControls(){
  const service=getService()||{},content=Boolean($('chat-input').value.trim()||imageDataUrl),imageReady=!imageURL||Boolean(imageDataUrl),voiceWork=Boolean(voiceUI?.hasUnsavedWork()),voiceActive=Boolean(voiceUI?.isActive()),ready=content&&!imagePreparing&&imageReady&&!voiceWork;
  $('chat-send').disabled=busy||saving||!ready;$('chat-send').hidden=busy;$('chat-cancel').hidden=!busy;
  for(const element of[$('chat-input'),$('chat-add-image'),$('chat-remove-image'),$('chat-consent'),$('chat-payload'),$('chat-auto-save')])element.disabled=busy||saving||voiceActive;
  for(const input of host.querySelectorAll('.chat-crop-grid input'))input.disabled=busy||voiceActive||!imageURL;
  for(const button of host.querySelectorAll('[data-chat-save],[data-chat-edit],[data-chat-undo]'))button.disabled=busy||saving||voiceWork||button.dataset.locked==='true';
  voiceUI?.setBlocked(busy||saving||imagePreparing);
 }
 function scrollBottom(){const log=$('chat-messages');log.scrollTop=log.scrollHeight;}
 function render(){
  const log=$('chat-messages');log.replaceChildren();
  if(!turns.length){const empty=document.createElement('div');empty.className='chat-empty';empty.innerHTML=sticker('book','chat-empty-cat');empty.append(textNode('h2','','发来这笔账，我来整理'),textNode('p','','发一句话或付款截图。信息明确就直接记下，拿不准的我会再问你。'));const examples=document.createElement('div');examples.className='chat-examples';for(const value of['午饭 28，地铁 6','昨天买书花了 45 元','工资到账 5000']){const button=textNode('button','',value);button.type='button';button.dataset.chatExample=value;examples.append(button);}empty.append(examples);log.append(empty);}
  for(const turn of turns){const row=document.createElement('article');row.className=`chat-turn chat-turn-${turn.role}`;row.append(textNode('span','chat-speaker',turn.role==='user'?'我':'轻记 AI'));const bubble=textNode('div','chat-bubble','');if(turn.voiceDuration){const voice=textNode('div','chat-voice-message',`语音转文字 · ${turn.voiceDuration} 秒`);bubble.append(voice);}if(turn.text)bubble.append(textNode('span','chat-message-text',turn.text));if(turn.imageThumb){const img=document.createElement('img');img.src=turn.imageThumb;img.alt='本次对话中的账单缩略图';img.className='chat-message-image';bubble.append(img);}if(turn.failed)bubble.append(textNode('small','chat-turn-failed','这次未完成，原输入仍在下方。'));row.append(bubble);for(const card of turn.cards||[])row.append(renderCard(card));log.append(row);}
  if(busy){const thinking=textNode('article','chat-turn chat-turn-assistant chat-thinking','');thinking.append(textNode('div','chat-bubble',saving?'正在记入账本…':'正在识别这条消息…'));log.append(thinking);}
  syncControls();scrollBottom();
 }
 function renderCard(card){
  const node=document.createElement('section');node.className=`chat-card chat-card-${card.state}`;node.dataset.cardId=card.id;
  const top=document.createElement('div');top.className='chat-card-top';const art=document.createElement('span');art.className='chat-card-sticker';art.innerHTML=recordSticker(card.draft);const amount=textNode('strong','chat-card-amount',card.draft.amountCents==null?'金额待补':formatMoney(card.draft.amountCents));const heading=document.createElement('div');heading.append(textNode('small','',TYPES[card.draft.type]||'收支待核对'),amount);top.append(art,heading);node.append(top);
  node.append(textNode('h3','chat-card-merchant',card.draft.merchant||'商户 / 用途待补'));
  const meta=document.createElement('div');meta.className='chat-card-meta';for(const value of[card.draft.category,card.draft.purpose,card.draft.channel!=='其他'?card.draft.channel:''].filter(Boolean))meta.append(textNode('span','',value));node.append(meta);
  node.append(textNode('p','chat-card-date',card.draft.date?card.draft.date.replace('T',' '):'日期没有读到，请核对'));
  if(card.notice)node.append(textNode('p','chat-card-warning',card.notice));
  if(card.draft.notes)node.append(textNode('p','chat-card-note',card.draft.notes));
  const actions=document.createElement('div');actions.className='chat-card-actions';const notice=textNode('span','chat-card-state','');const edit=textNode('button','text-button','修改');edit.type='button';edit.dataset.chatEdit=card.id;
  const save=textNode('button','button primary',needsAttention(card.draft)||card.manualReview?'补全并核对':'记下');save.type='button';save.dataset.chatSave=card.id;
  if(card.state==='saved'){notice.textContent='已记下';save.hidden=true;}
  else if(card.state==='replaced'||card.state==='cancelled'){notice.textContent=card.state==='cancelled'?'已取消':'已由后续补充更新';save.hidden=true;edit.hidden=true;edit.dataset.locked='true';}
  else if(card.state==='undone'){notice.textContent='已撤销';save.textContent=needsAttention(card.draft)?'补全并核对':'重新记下';}
  else{notice.textContent=needsAttention(card.draft)?'有信息需要补全':'待确认';}
  actions.append(notice,edit,save);if(card.state==='saved'&&getUndoableId?.()===card.id){const undo=textNode('button','text-button','撤销');undo.type='button';undo.dataset.chatUndo=card.id;actions.append(undo);}node.append(actions);return node;
 }
 function releaseImage(){imageRun++;imagePreparing=false;image=null;imageDataUrl='';imageThumb='';if(imageURL)URL.revokeObjectURL(imageURL);imageURL='';$('chat-image-preview').removeAttribute('src');$('chat-attachment').hidden=true;$('chat-image-crop').hidden=true;$('chat-image-crop').open=false;$('chat-file').value='';for(const edge of['top','left'])$('chat-crop-'+edge).value='0';for(const edge of['bottom','right'])$('chat-crop-'+edge).value='100';for(const input of host.querySelectorAll('.chat-crop-grid input'))input.disabled=true;}
 function makeJPEG(photo,left,top,right,bottom,maxEdge,maxPixels,quality){
  const x=Math.floor(photo.naturalWidth*left/100),y=Math.floor(photo.naturalHeight*top/100),width=Math.floor(photo.naturalWidth*(right-left)/100),height=Math.floor(photo.naturalHeight*(bottom-top)/100);
  const scale=Math.min(1,maxEdge/Math.max(width,height),Math.sqrt(maxPixels/(width*height)));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));const context=canvas.getContext('2d');if(!context)throw new Error();context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(photo,x,y,width,height,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',quality);canvas.width=canvas.height=1;return data;
 }
 function crop(){
  imageDataUrl='';imageThumb='';$('chat-image-preview').removeAttribute('src');
  if(!image){syncControls();return;}
  const bounds=['left','top','right','bottom'].map(edge=>Number($('chat-crop-'+edge).value)),[left,top,right,bottom]=bounds;
  if(!bounds.every(Number.isFinite)||left<0||top<0||right>100||bottom>100||right-left<2||bottom-top<2){status('裁剪至少保留 2%，右边需大于左边，下边需大于上边。','error');updatePayload();return;}
  try{const data=makeJPEG(image,left,top,right,bottom,1600,1600000,.88);if(data.length>4*1024*1024)throw new Error();imageDataUrl=data;imageThumb=makeJPEG(image,left,top,right,bottom,320,100000,.72);$('chat-image-preview').src=data;status('图片已准备好，点“发送”交给 AI 识别。');}catch{status('图片暂时无法准备，请缩小裁剪范围或重新选择。','error');}
  updatePayload();
 }
 async function chooseImage(file){
  if(!file||busy)return;
  releaseImage();
  if(file.size>20*1024*1024||!['image/png','image/jpeg','image/webp','image/bmp'].includes(file.type)){status('请选择不超过 20MB 的 PNG、JPEG、WebP 或 BMP 图片。','error');return;}
  const run=++imageRun;imagePreparing=true;syncControls();status('正在本机准备图片，尚未发送。');
  try{imageURL=URL.createObjectURL(file);const photo=new Image();photo.decoding='async';photo.src=imageURL;await photo.decode();if(run!==imageRun)return;if(!photo.naturalWidth||photo.naturalWidth*photo.naturalHeight>32000000)throw new Error();image=photo;for(const edge of['top','left'])$('chat-crop-'+edge).value='0';for(const edge of['bottom','right'])$('chat-crop-'+edge).value='100';$('chat-attachment').hidden=false;$('chat-image-crop').hidden=false;imagePreparing=false;crop();requestAnimationFrame(fitViewport);}catch{if(run!==imageRun)return;releaseImage();status('这张图片无法读取，请换一张清晰的账单图。','error');syncControls();}
 }
 function stopRequest(message=SAFE_ERRORS.ABORTED){requestRun++;controller?.abort();controller=null;busy=false;status(message);syncControls();}
 function safeError(error){const code=String(error?.code||'').toUpperCase();return SAFE_ERRORS[code]||({HOST:SAFE_ERRORS.CONFIG,KEY:SAFE_ERRORS.AUTH,PAYLOAD:SAFE_ERRORS.RESPONSE,MODE:SAFE_ERRORS.CONFIG,CANCELLED:SAFE_ERRORS.ABORTED,RATE:SAFE_ERRORS.RATE_LIMIT,SIZE:SAFE_ERRORS.RESPONSE,SERVER:SAFE_ERRORS.RESPONSE,REDIRECT:SAFE_ERRORS.NETWORK,SESSION_CHANGED:SAFE_ERRORS.SESSION})[code]||SAFE_ERRORS.RESPONSE;}
 function newCard(draft){const id=newId();return{id,state:'pending',savedOnce:false,draft:{...draft,id,source:'ai',status:'pending'}};}
 function replacePending(drafts,text){
  const previous=pendingCards();if(fingerprint(previous.map(card=>card.draft))===fingerprint(drafts))return[];
  if(!drafts.length&&previous.length&&!/不记|取消|删掉|删除|不要.*记/.test(text))return[];
  for(const card of previous)card.state=drafts.length?'replaced':'cancelled';
  return drafts.map(newCard);
 }
 function requestConsent(){consentSignature=JSON.stringify(expectedService());const service=getService();$('chat-send-target').textContent=`发送到 ${service.endpoint}\n模型：${service.model}`;$('chat-send-image').hidden=!imageDataUrl;if(imageDataUrl)$('chat-send-image').src=imageDataUrl;else $('chat-send-image').removeAttribute('src');$('chat-send-dialog').showModal();}
 async function send(event){
  event?.preventDefault?.();refreshService();if(busy||saving)return;
  if(voiceUI?.hasUnsavedWork()){status('请先松开或取消语音，再发送。');return;}
  const service=getService()||{},text=$('chat-input').value.trim();
  if(!service.configured||!service.hasKey){status('先配置自己的接口与密钥。消息会保留。','error');$('chat-service-details').open=true;return;}
  if(imagePreparing||(!text&&!imageDataUrl))return;
  if(imageURL&&!imageDataUrl){status('图片尚未准备好，请调整裁剪或重新选图。','error');return;}
  if(!navigator.onLine){status('当前离线，AI 需要网络。消息仍保留。','error');return;}
  if(!$('chat-consent').checked){requestConsent();return;}
  if(turns.length>=64){status('请先处理待核对账单，再点“新对话”。','error');return;}
  if(!pendingCards().length&&allCards().some(card=>card.savedOnce)&&/^(?:刚才|上一笔|上笔|这笔|那笔|修改|改成|更正).*(?:改|不是|是|成|\d)/.test(text)){turns.push({role:'assistant',text:'已记下的账单请点卡片“修改”，我会更正原记录。'});render();status('这条提示在本机生成。');return;}
  if(!payloadEdited)updatePayload();const payload=$('chat-payload').value.trim();if(!payload||payload.length>12000){status('消息内容为空或过长，请修改后再发送。','error');return;}
  const selected=expectedService(),sentImage=imageDataUrl,sentThumb=imageThumb,autoSave=$('chat-auto-save').checked,voice=pendingVoice;pendingVoice=null;
  const run=++requestRun;controller=new AbortController();const signal=controller.signal;busy=true;
  const userTurn={role:'user',text:text||(sentImage?'':'请帮我记账'),imageThumb:sentThumb,voiceDuration:voice?.durationSeconds};turns.push(userTurn);render();status('');
  try{
   const result=await request({payload,...(sentImage?{imageDataUrl:sentImage}:{}),signal,expectedService:selected});if(run!==requestRun||signal.aborted)return;
   const drafts=Array.isArray(result?.drafts)?result.drafts:[],cards=replacePending(drafts,text),answer={role:'assistant',text:cards.length?'正在整理账单…':(pendingCards().length?'没有新增账目，待核对卡片仍在上方。请补充要修改的金额或商户。':'没有找到可记下的交易。请补充金额、商户和付款时间，或发一张清晰的付款详情。'),cards};turns.push(answer);
   $('chat-input').value='';releaseImage();payloadEdited=false;resizeInput();
   let saved=0;
   if(autoSave&&cards.length){saving=true;savingOwner=run;render();for(const card of cards){
    if(run!==requestRun||signal.aborted)break;
    if(needsAttention(card.draft)||card.draft.type==='transfer'){card.manualReview=true;card.notice=card.draft.type==='transfer'?'转账先核对，避免当成消费。':'有信息不明确，请补全核对后记下。';continue;}
    try{const record=await onSave({...card.draft},{automatic:true,signal});if(record){card.draft={...card.draft,...record};card.state='saved';card.savedOnce=true;saved++;}}
    catch(error){if(error?.name==='AbortError')break;card.notice=error?.code==='DUPLICATE'?'这笔可能已经记过，未重复入账。':'这笔没有保存，请核对后再记下。';}
   }}
   if(run!==requestRun)return;
   const pending=cards.filter(card=>card.state!=='saved').length;
   if(cards.length)answer.text=saved?`已记下 ${saved} 笔。${pending?`还有 ${pending} 笔需要你核对。`:'金额、商户和分类见下方，可随时修改或撤销。'}`:autoSave?'这些账单需要先核对，暂未新增账目。':`整理了 ${cards.length} 笔，点卡片“记下”即可保存。`;
   status('');
  }catch(error){if(run!==requestRun)return;userTurn.failed=true;const message=sentImage&&['RESPONSE','IMAGE'].includes(String(error?.code||'').toUpperCase())?'这次图片未能识别，请检查所选模型是否支持图片；也可换张清晰截图。':safeError(error);turns.push({role:'assistant',text:'这次没有新增账目。'+message});status(message,'error');}
  finally{if(savingOwner===run){saving=false;savingOwner=null;}if(run===requestRun){busy=false;controller=null;updatePayload();render();requestAnimationFrame(fitViewport);}}
 }
 async function saveCard(card){
  if(busy||saving||voiceUI?.hasUnsavedWork()||!['pending','undone'].includes(card.state))return;
  if(needsAttention(card.draft)||card.manualReview){onEdit({...card.draft});return;}
  saving=true;syncControls();status('正在记入本机账本……');
  try{const record=await onSave({...card.draft});if(record){card.draft={...card.draft,...record};card.state='saved';card.savedOnce=true;status('已记下，账目保存在本机。');}else status('已取消保存，卡片仍保留在这段对话中。');}
  catch{status('这次没有保存，请检查卡片；原内容仍保留。','error');}
  finally{saving=false;render();updatePayload();}
 }
 function syncSavedRecords(){let changed=false;for(const card of allCards()){const record=getRecord(card.id);if(record){const next={...card.draft,...record};if(card.state!=='saved'||JSON.stringify(card.draft)!==JSON.stringify(next)){card.draft=next;card.state='saved';card.savedOnce=true;changed=true;}}else if(card.savedOnce&&card.state==='saved'){card.state='undone';changed=true;}}if(changed){render();updatePayload();}}
 function clearSession(){pendingVoice=null;if($('chat-send-dialog').open)$('chat-send-dialog').close();voiceUI?.cancel({silent:true});voiceUI?.closeDialog();stopRequest('');releaseImage();turns=[];payloadEdited=false;$('chat-input').value='';$('chat-api-key').value='';$('chat-consent').checked=false;updatePayload();render();status('新对话已准备，已保存的账目保留。');}
 function confirmClear(){const hadVoice=Boolean(voiceUI?.hasUnsavedWork());voiceUI?.cancel({silent:true});if(!turns.length&&!$('chat-input').value.trim()&&!image&&!imageURL&&!hadVoice){clearSession();return;}$('chat-clear-dialog').showModal();}
 function sessionChanged(){if($('chat-send-dialog').open)$('chat-send-dialog').close();pendingVoice=null;voiceUI?.cancel({silent:true});if(busy)stopRequest(SAFE_ERRORS.SESSION);$('chat-api-key').value='';refreshService({reset:true});updatePayload();}
 $('chat-form').addEventListener('submit',send);
 function resizeInput(){$('chat-input').style.height='auto';$('chat-input').style.height=Math.min(80,Math.max(44,$('chat-input').scrollHeight))+'px';requestAnimationFrame(fitViewport);}
 $('chat-input').addEventListener('input',()=>{pendingVoice=null;resizeInput();updatePayload();});
 $('chat-input').addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();$('chat-form').requestSubmit();}});
 $('chat-consent').addEventListener('change',syncControls);
 $('chat-auto-save').addEventListener('change',()=>{$('chat-mode-label').textContent=$('chat-auto-save').checked?'自动记账 · 更多':'核对后记账 · 更多';});
 $('chat-send-dismiss').addEventListener('click',()=>{$('chat-send-dialog').close();});
 $('chat-send-accept').addEventListener('click',()=>{if(consentSignature!==JSON.stringify(expectedService())){$('chat-send-dialog').close();status(SAFE_ERRORS.SESSION,'error');return;}$('chat-consent').checked=true;$('chat-send-dialog').close();send();});
 $('chat-payload').addEventListener('input',()=>{payloadEdited=true;syncControls();});
 $('chat-add-image').addEventListener('click',()=>$('chat-file').click());$('chat-file').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';chooseImage(file);});
 $('chat-remove-image').addEventListener('click',()=>{releaseImage();updatePayload();status('已移除本次图片。');requestAnimationFrame(fitViewport);});for(const input of host.querySelectorAll('.chat-crop-grid input'))input.addEventListener('input',crop);
 $('chat-cancel').addEventListener('click',()=>stopRequest());$('chat-clear').addEventListener('click',confirmClear);$('chat-clear-cancel').addEventListener('click',()=>$('chat-clear-dialog').close());$('chat-clear-confirm').addEventListener('click',()=>{$('chat-clear-dialog').close();clearSession();});
 $('chat-configure').addEventListener('click',onConfigure);
 $('chat-use-key').addEventListener('click',()=>{const value=$('chat-api-key').value;$('chat-api-key').value='';try{setSessionKey(value);refreshService({reset:true});if(getService()?.hasKey){$('chat-service-details').open=false;status('密钥只在本次页面暂存。确认发送范围后，就可以开始。');}else status('请填写有效的本次密钥。','error');}catch{status('密钥格式不正确，请检查后重新填写。','error');}});
 $('chat-messages').addEventListener('click',event=>{if(voiceUI?.hasUnsavedWork())return;const undo=event.target.closest('[data-chat-undo]');if(undo){if(!busy&&!saving&&getUndoableId?.()===undo.dataset.chatUndo)onUndo?.();return;}const example=event.target.closest('[data-chat-example]');if(example){$('chat-input').value=example.dataset.chatExample;updatePayload();$('chat-input').focus();return;}const save=event.target.closest('[data-chat-save]'),edit=event.target.closest('[data-chat-edit]');const id=save?.dataset.chatSave||edit?.dataset.chatEdit,card=allCards().find(item=>item.id===id);if(!card||busy||saving)return;if(save)saveCard(card);else if(edit&&!['replaced','cancelled'].includes(card.state))onEdit({...((getRecord(card.id))||card.draft)});});
 window.addEventListener('qingji-ai-session',sessionChanged);
 window.addEventListener('pagehide',()=>{stopRequest('');clearSession();$('chat-api-key').value='';});
 function fitViewport(){if(!active)return;const viewport=window.visualViewport,height=viewport?.height||innerHeight,keyboard=height<innerHeight-100;document.body.classList.toggle('chat-keyboard-active',keyboard);host.style.setProperty('--chat-viewport-height',`${height}px`);const top=host.querySelector('.chat-shell').getBoundingClientRect().top,bottom=(viewport?.offsetTop||0)+height,nav=document.querySelector('.bottom-nav'),navRect=nav?.getBoundingClientRect();const edge=!keyboard&&navRect?.height?Math.min(bottom-8,navRect.top-8):bottom-6;host.style.setProperty('--chat-shell-height',`${Math.max(80,Math.floor(edge-top))}px`);}
 for(const details of host.querySelectorAll('details'))details.addEventListener('toggle',()=>requestAnimationFrame(fitViewport));
 $('chat-input').addEventListener('focus',()=>requestAnimationFrame(fitViewport));
 window.visualViewport?.addEventListener('resize',fitViewport);window.addEventListener('resize',fitViewport);
 voiceUI=createVoiceUI({host,input:$('chat-input'),onChange:syncControls,onStatus:status,onSend:voice=>{pendingVoice=voice;send();}});
 refreshService();updatePayload();render();
 return{setActive(value){active=Boolean(value);document.body.classList.toggle('chat-active',active);if(!active){if(busy)stopRequest('已停止本次处理，已保存的账目保留。');if($('chat-send-dialog').open)$('chat-send-dialog').close();voiceUI.cancel({silent:true});voiceUI.closeDialog();document.body.classList.remove('chat-keyboard-active');}refreshService();if(active){syncSavedRecords();fitViewport();requestAnimationFrame(fitViewport);scrollBottom();}},hasUnsavedWork:()=>Boolean(busy||saving||voiceUI.hasUnsavedWork()||imagePreparing||image||imageURL||$('chat-input').value.trim()||$('chat-api-key').value||pendingCards().length),syncSavedRecords,clear:confirmClear,isBusy:()=>busy||saving||voiceUI.isActive()};
}
