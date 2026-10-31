import{formatMoney}from'./core.js';
import{validDate}from'./data.js';
import{recordSticker,sticker}from'./stickers.js';
import{icon}from'./icons.js';
import{buildChatPayload,explainNoDrafts}from'./ai-chat-client.js';
import{AI_LIMITS}from'./ai-client.js';
import{getImageSupport}from'./ai-capabilities.js';
import{createVoiceUI}from'./voice-ui.js';
import{createChatHistory}from'./chat-history.js';
import{createChatHistoryUI}from'./chat-history-ui.js';

const TYPES={expense:'支出',income:'收入',refund:'退款',transfer:'转账'};
const SAFE_ERRORS={VISION:'所选模型只支持文字，不能直接识别图片。请自行选择支持图片的模型，或用首页截图记账。本次图片尚未发送。',CONFIG:'请先检查接口地址、模型和发送方式。',AUTH:'密钥未通过验证，请检查后重新填写。',RATE_LIMIT:'服务商提示额度或请求频率受限，请查看自己的服务账户。',NETWORK:'暂时连接不上接口，请检查网络和服务商是否允许网页跨域访问。',TIMEOUT:'等待超时，没有自动重试；服务商仍可能已经处理并计费。',ABORTED:'已取消等待，没有自动重试；已发出的请求仍可能被处理和计费。',RESPONSE:'返回内容无法安全整理成账单，请保留原输入再核对。',IMAGE:'图片还没有准备好，请重新检查预览。',SESSION:'接口或密钥已变化，请重新核对本次发送范围。'};
const IMAGE_BLOCKED_MESSAGE='图片未发送：当前模型只支持文字。请点“选择识图模型”。';
const newId=()=>globalThis.crypto?.randomUUID?.()||`chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const plainFields=['amountCents','type','date','merchant','category','purpose','channel','notes','currency','paymentState'];
function plainDraft(draft){const value={};for(const field of plainFields)value[field]=draft?.[field]??(field==='amountCents'?null:'');return value;}
function fingerprint(drafts){return JSON.stringify(drafts.map(draft=>({...plainDraft(draft),imageIndex:Number.isInteger(draft.imageIndex)?draft.imageIndex:null,needsAttention:Boolean(draft.needsAttention)})));}
function needsAttention(draft){return Boolean(draft.needsAttention)||!Number.isSafeInteger(draft.amountCents)||draft.amountCents<=0||draft.amountCents>99999999999||!draft.merchant?.trim()||/^(未知|其他|未识别商户|商户未知|商户待补)$/.test(draft.merchant.trim())||!validDate(draft.date)||draft.currency!=='CNY'||['uncertain','not_completed'].includes(draft.paymentState);}
function textNode(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;node.textContent=text;return node;}

/** Only sent messages, thumbnails and card snapshots enter local history.
 * Full images, credentials, request previews and consent remain ephemeral. */
export function createChatUI({host,getService,setSessionKey,onConfigure,request,onSave,onEdit,onUndo,getUndoableId,getToday,getRecord,isLedgerReady=()=>true,sanitizeHistoryText=value=>value}){
 let turns=[],busy=false,saving=false,savingOwner=null,controller=null,requestRun=0,serviceSignature='',serviceWasReady=false,active=false;
 let image=null,imageURL='',imageDataUrl='',imageThumb='',imageRun=0,imagePreparing=false,images=[],activeImageId='';
 const IMAGE_LIMITS={count:AI_LIMITS.imageCount,each:AI_LIMITS.imageBytes,total:AI_LIMITS.imageTotalBytes};
 let payloadEdited=false,payloadSource='',voiceUI=null,pendingVoice=null,consentSignature='';
 const historyStore=createChatHistory(),SESSION_ID='qingji-chat-current-v1',CLEAR_EPOCH='qingji-chat-history-cleared-v1';
 let conversationId='',createdAt='',historyLoading=true,historyReadOnly=false,historyWriting=false,historyGeneration=0,historyQueue=Promise.resolve(),historyFailed=false,historyUI=null,historySavedAt=null,historyClock=0,historyBranch=false;
 const readClearEpoch=()=>{try{return localStorage.getItem(CLEAR_EPOCH)||'';}catch{return null;}};
 let clearEpoch=readClearEpoch();
 const $=id=>host.querySelector('#'+id);
 host.innerHTML=`<div class="page-heading chat-heading"><div><p class="eyebrow">发一句话，或多张付款截图</p><h1>轻记 AI</h1></div><div class="chat-heading-actions"><button id="chat-history" type="button" class="text-button">历史记录</button><button id="chat-clear" type="button" class="text-button">新对话</button></div></div>
  <div class="chat-shell">
   <details id="chat-service-details" class="chat-service-details"><summary id="chat-service">先配置自己的 AI 接口</summary><div id="chat-key-row"><label for="chat-api-key">本次 API 密钥</label><div class="chat-key-input"><input id="chat-api-key" type="password" maxlength="2048" autocomplete="off" spellcheck="false" placeholder="只在当前页面暂存"><button id="chat-use-key" type="button" class="button secondary">本次使用</button></div></div><button id="chat-configure" type="button" class="text-button">设置接口</button><p id="chat-destination" class="micro-copy"></p><p class="micro-copy">只向选定接口发送本次文字、主动选取的图片和未记下的卡片。接口可能收费，整本账不会发送。</p></details>
   <details id="chat-options" class="chat-options"><summary id="chat-mode-label">自动记账 · 更多</summary><label class="check-label"><input id="chat-auto-save" type="checkbox" checked>信息明确的账单直接记下；疑似重复或缺信息时先核对</label><label class="check-label chat-consent"><input id="chat-consent" type="checkbox"><span id="chat-consent-text">允许本次对话向选定接口发送消息，可能产生费用。</span></label><details id="chat-payload-details" class="chat-payload-details"><summary>查看本次发送内容</summary><label for="chat-payload">可修改；图片按下方预览发送</label><textarea id="chat-payload" rows="4" maxlength="${AI_LIMITS.previewChars}" autocomplete="off" spellcheck="false"></textarea></details><p class="micro-copy">已记下的账目可修改或撤销；聊天记录自动保存在本机，可在顶部历史记录中查看或清空。</p></details>
   <p id="chat-history-state" class="chat-history-state" role="status">正在读取本机聊天记录…</p>
   <div id="chat-messages" class="chat-messages" role="log" aria-label="本次记账对话" aria-live="polite" aria-relevant="additions"></div>
   <p id="chat-status" class="chat-status" role="status" aria-live="polite"></p>
   <div id="chat-readonly-bar" class="chat-readonly-bar" hidden><span>上次对话 · 仅查看</span><button id="chat-start-new" class="button primary" type="button">开始新对话</button></div>
   <form id="chat-form" class="chat-composer">
    <div id="chat-attachment" class="chat-attachment" hidden><div class="chat-attachment-main"><img id="chat-image-preview" alt="当前选中的待发送账单图片"><span id="chat-image-label">待发送图片</span><button id="chat-fix-model" type="button" class="text-button" hidden>选择识图模型</button><button id="chat-remove-image" type="button" class="text-button">清空</button></div><div id="chat-image-list" class="chat-image-list" role="group" aria-label="本次待发送的图片，可选择裁剪或逐张移除" hidden></div></div>
    <details id="chat-image-crop" hidden><summary id="chat-image-crop-label">检查 / 裁剪图片</summary><p class="micro-copy">保留商户、实付金额和付款时间，裁掉不需要的隐私信息。</p><div class="chat-crop-grid"><label>上边 %<input id="chat-crop-top" type="number" inputmode="numeric" min="0" max="99" value="0"></label><label>下边 %<input id="chat-crop-bottom" type="number" inputmode="numeric" min="1" max="100" value="100"></label><label>左边 %<input id="chat-crop-left" type="number" inputmode="numeric" min="0" max="99" value="0"></label><label>右边 %<input id="chat-crop-right" type="number" inputmode="numeric" min="1" max="100" value="100"></label></div></details>
    <label class="sr-only" for="chat-input">消息</label><div class="chat-composer-actions"><textarea id="chat-input" maxlength="2000" rows="1" placeholder="输入消息…" autocomplete="off"></textarea><button id="chat-add-image" type="button" class="chat-image-button" aria-label="添加账单图片，最多 ${IMAGE_LIMITS.count} 张">${icon('plus')}</button><button id="chat-send" type="submit" class="button primary">发送</button><button id="chat-cancel" type="button" class="text-button" hidden>停止</button></div>
   </form>
  </div><input id="chat-file" type="file" multiple accept="image/png,image/jpeg,image/webp,image/bmp" hidden>
  <dialog id="chat-send-dialog" class="sheet-dialog small-dialog" aria-labelledby="chat-send-title"><h2 id="chat-send-title">开始这次 AI 对话</h2><p id="chat-send-target"></p><p>本次会话的消息和你主动选择的图片将发送到这个接口，服务商可能收费。自动记账开启时，信息明确的账单会直接保存在本机；有疑问的账单先核对。</p><div id="chat-send-images" class="chat-send-images" tabindex="0" aria-label="本次图片缩略预览，滚动查看"><img id="chat-send-image" alt="即将发送的第 1 张图片" hidden></div><div class="dialog-actions"><button id="chat-send-dismiss" type="button" class="button secondary">先不发送</button><button id="chat-send-accept" type="button" class="button primary">同意并发送</button></div></dialog>
  <dialog id="chat-clear-dialog" class="sheet-dialog small-dialog"><h2>开始一段新对话？</h2><p>这段已发送的对话会保留在“历史记录”。未发送的文字和图片将清空，已经记下的账目保留。</p><div class="dialog-actions"><button id="chat-clear-cancel" class="button secondary" type="button">继续这段</button><button id="chat-clear-confirm" class="button primary" type="button">开始新对话</button></div></dialog>`;

 function rememberConversation(){try{sessionStorage.setItem(SESSION_ID,conversationId);}catch{}}
 function freshConversation(){conversationId=newId();createdAt=new Date().toISOString();historyReadOnly=false;historySavedAt=null;historyClock=Date.now();historyBranch=false;rememberConversation();}
 function historyState(message=''){const node=$('chat-history-state');node.textContent=message||(historyReadOnly?'上次对话仅供查看，账单状态已按本机账本核对。':historyBranch?'另一页面也在聊天，本页已单独保存，双方记录都保留。':turns.length?'聊天记录保存在本机 · 图片仅保留缩略图':'聊天记录将保存在本机');node.dataset.kind=historyFailed?'error':'';}
 function discardClearedHistory(){historyGeneration++;requestRun++;controller?.abort();controller=null;busy=false;saving=false;savingOwner=null;voiceUI?.cancel({silent:true});turns=[];freshConversation();historyFailed=false;$('chat-consent').checked=false;payloadEdited=false;updatePayload();render();historyState('聊天记录已在另一页面清空，账本和未发送的输入保留。');}
 function persistHistory(){
  if(historyLoading||historyReadOnly||historyUI?.isClearing()||!turns.length)return historyQueue;
  const generation=historyGeneration,now=new Date(Math.max(Date.now(),historyClock+1)).toISOString();historyClock=Date.parse(now);for(const turn of turns)if(!turn.at)turn.at=now;
  const snapshot={id:conversationId,createdAt,updatedAt:now,turns:turns.map(turn=>({...turn,...(Array.isArray(turn.imageThumbs)?{imageThumbs:[...turn.imageThumbs]}:{}),...(Array.isArray(turn.imageResults)?{imageResults:turn.imageResults.map(result=>({...result}))}:{}),text:sanitizeHistoryText(turn.text||''),cards:(turn.cards||[]).map(card=>({...card,notice:sanitizeHistoryText(card.notice||''),draft:{...card.draft,merchant:sanitizeHistoryText(card.draft.merchant||''),purpose:sanitizeHistoryText(card.draft.purpose||''),notes:sanitizeHistoryText(card.draft.notes||'')}}))}))};
  historyQueue=historyQueue.then(async()=>{
   if(generation!==historyGeneration)return;const epoch=readClearEpoch();if(clearEpoch!==null&&epoch!==clearEpoch){clearEpoch=epoch;discardClearedHistory();return;}
   try{snapshot.id=conversationId;let saved;try{saved=await historyStore.save(snapshot,{expectedUpdatedAt:historySavedAt});}catch(error){if(error?.code!=='conflict')throw error;if(generation!==historyGeneration)return;conversationId=newId();rememberConversation();historySavedAt=null;historyBranch=true;snapshot.id=conversationId;saved=await historyStore.save(snapshot,{expectedUpdatedAt:null});}if(generation!==historyGeneration)return;historySavedAt=saved.updatedAt;historyFailed=false;historyState();}
   catch(error){if(generation!==historyGeneration)return;if(error?.code==='cleared'){clearEpoch=readClearEpoch();discardClearedHistory();return;}historyFailed=true;historyState('聊天记录未能保存，请检查浏览器存储和可用空间。账本保存结果以卡片为准。');}
  });
  return historyQueue;
 }
 async function restoreHistory(){
  const generation=historyGeneration;
  try{
   let id='';try{id=sessionStorage.getItem(SESSION_ID)||'';}catch{}
   let saved=id?await historyStore.get(id):null;
   if(saved){conversationId=saved.id;createdAt=saved.createdAt;turns=saved.turns;historySavedAt=saved.updatedAt;historyClock=Date.parse(saved.updatedAt);}
   else if(id){freshConversation();}
   else{const entries=await historyStore.list();saved=entries.length?await historyStore.get(entries[0].id):null;if(saved){conversationId=saved.id;createdAt=saved.createdAt;turns=saved.turns;historyReadOnly=true;}else freshConversation();}
   for(const turn of turns)if(turn.text==='正在整理账单…')turn.text='上次处理未完成，请以卡片和流水中的保存状态为准。';
   if(turns.at(-1)?.role==='user')turns.at(-1).failed=true;
   for(const card of allCards())if(card.state==='pending'){card.manualReview=true;card.notice='上次尚未记下，请重新核对后保存。';}
   historyFailed=false;
  }catch{freshConversation();historyFailed=true;}
  historyLoading=false;if(generation!==historyGeneration){discardClearedHistory();return;}syncSavedRecords();updatePayload();render();historyState(historyFailed?'聊天历史暂时无法读取；本次可继续记账，但请勿依赖聊天自动保存。':'');
 }
 function pendingCards(){return historyReadOnly?[]:turns.flatMap(turn=>turn.cards||[]).filter(card=>card.state==='pending');}
 function allCards(){return turns.flatMap(turn=>turn.cards||[]);}
 function status(message='',kind=''){$('chat-status').textContent=message;$('chat-status').dataset.kind=kind;}
 function expectedService(){const service=getService()||{};return{endpoint:service.endpoint||'',model:service.model||'',mode:service.mode||'text'};}
 function refreshService({reset=false}={}){
  const service=getService()||{},signature=JSON.stringify(expectedService());
  if(reset||signature!==serviceSignature){$('chat-consent').checked=false;serviceSignature=signature;}
  let hostname='未配置';try{if(service.endpoint)hostname=new URL(service.endpoint).hostname;}catch{}
  $('chat-service').textContent=service.configured?`${hostname} · ${service.model}`:'先配置自己的 AI 接口';
  $('chat-destination').textContent=service.configured?`发送到：${service.endpoint}`:'进入设置，填写自己的 HTTPS 接口、模型和密钥后再使用。';
  const support=getImageSupport(service);if(service.configured&&support.supported!==null)$('chat-destination').textContent+='\n'+support.reason;
  $('chat-key-row').hidden=!service.configured||Boolean(service.hasKey);
  const ready=Boolean(service.configured&&service.hasKey);
  if(ready&&!serviceWasReady)$('chat-service-details').open=false;
  serviceWasReady=ready;
  $('chat-consent-text').textContent=service.configured?`同意本次对话向 ${hostname} 发送上述内容，可能产生费用。`:'配置后，确认本次对话的发送范围与费用。';
  syncControls();
 }
 function updatePayload(){
  if(busy)return;
  try{payloadSource=buildChatPayload({text:$('chat-input').value,currentDrafts:pendingCards().map(card=>card.draft),referenceDate:getToday(),hasImage:images.length>0,imageCount:images.length});$('chat-payload').value=payloadSource;payloadEdited=false;}catch{payloadSource='';$('chat-payload').value='';payloadEdited=false;}
  syncControls();
 }
 function syncControls(){
  const service=getService()||{},content=Boolean($('chat-input').value.trim()||images.length),imageReady=images.every(item=>Boolean(item.data)),voiceWork=Boolean(voiceUI?.hasUnsavedWork()),voiceActive=Boolean(voiceUI?.isActive()),ready=content&&!imagePreparing&&imageReady&&!voiceWork;
  const blockedImage=images.length>0&&getImageSupport(service).supported===false;
  $('chat-fix-model').hidden=!blockedImage;$('chat-fix-model').disabled=busy||saving||voiceActive;$('chat-image-label').hidden=blockedImage;
  $('chat-form').hidden=historyReadOnly;$('chat-readonly-bar').hidden=!historyReadOnly;
  $('chat-send').disabled=historyLoading||historyWriting||historyReadOnly||busy||saving||!ready;$('chat-send').hidden=busy;$('chat-cancel').hidden=!busy;
  for(const id of['chat-clear','chat-start-new','chat-history'])$(id).disabled=historyLoading||historyWriting||busy||saving||voiceActive;
  for(const element of[$('chat-input'),$('chat-add-image'),$('chat-remove-image'),$('chat-consent'),$('chat-payload'),$('chat-auto-save')])element.disabled=historyLoading||historyWriting||busy||saving||voiceActive;
  for(const input of host.querySelectorAll('.chat-crop-grid input'))input.disabled=busy||saving||voiceActive||imagePreparing||!image;
  for(const button of host.querySelectorAll('[data-image-select],[data-image-remove]'))button.disabled=busy||saving||voiceActive||imagePreparing;
  $('chat-add-image').disabled=historyLoading||historyWriting||busy||saving||voiceActive||imagePreparing||images.length>=IMAGE_LIMITS.count;
  for(const button of host.querySelectorAll('[data-chat-save],[data-chat-edit],[data-chat-undo]'))button.disabled=busy||saving||voiceWork||button.dataset.locked==='true';
  voiceUI?.setBlocked(historyLoading||historyWriting||historyReadOnly||busy||saving||imagePreparing);
 }
 function scrollBottom(){const log=$('chat-messages');log.scrollTop=log.scrollHeight;}
 function safeImageResults(value,count){
  const fixedReasons=new Set(['模型未说明这张图片的识别结果，请核对。','本图包含未完成或非人民币的账单，请核对，不会自动记账。','未确认是已完成交易，不会自动记账。']);
  const statuses=new Set(['identified','needs_review','not_transaction','unreadable']);return Array.from({length:count},(_,index)=>{const found=Array.isArray(value)?value.find(item=>item?.imageIndex===index+1):null;const state=statuses.has(found?.status)?found.status:'needs_review';return{imageIndex:index+1,status:state,reason:state==='identified'?'':fixedReasons.has(found?.reason)?found.reason:explainNoDrafts(found?.reason)};});
 }
 function renderImageResults(turn,{readOnly=false}={}){
  const list=textNode('ul','chat-image-results','');
  for(const result of turn.imageResults){const source=(turn.cards||[]).filter(card=>card.draft?.imageIndex===result.imageIndex);let saved=0,deleted=0,duplicate=0,pending=0,replaced=0,cancelled=0;
   for(const card of source){const exists=isLedgerReady()?getRecord(card.id):null;if(exists||(!isLedgerReady()&&!readOnly&&card.state==='saved'))saved++;else if(card.savedOnce&&isLedgerReady())deleted++;else if(card.state==='replaced')replaced++;else if(card.state==='cancelled')cancelled++;else if(card.notice?.includes('可能已经记过'))duplicate++;else pending++;}
   const parts=[];if(saved)parts.push(`已记下 ${saved} 笔`);if(deleted)parts.push(`${deleted} 笔已删除或撤销`);if(duplicate)parts.push(`${duplicate} 笔疑似重复，未自动记账`);if(pending)parts.push(`${pending} 笔待核对`);if(replaced)parts.push(`${replaced} 笔已由后续补充更新`);if(cancelled)parts.push(`${cancelled} 笔已取消`);
   if(!parts.length)parts.push(result.status==='not_transaction'?'未发现可记账的已完成交易':result.status==='unreadable'?'未能识别，请核对原图':result.status==='needs_review'?'识别结果待核对':'未生成可记下的账单');
   const row=textNode('li','',`图 ${result.imageIndex}：${parts.join('；')}`);row.dataset.resultImage=String(result.imageIndex);if(result.status!=='identified'&&result.reason)row.append(textNode('small','',result.reason));list.append(row);
  }
  return list;
 }
 function renderTurns(log,values,{readOnly=false}={}){
  log.replaceChildren();
  for(const turn of values){
   const row=document.createElement('article');row.className=`chat-turn chat-turn-${turn.role}`;const time=turn.at?new Date(turn.at):null;const label=(turn.role==='user'?'我':'轻记 AI')+(time&&!Number.isNaN(time.getTime())?' · '+time.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'');row.append(textNode('span','chat-speaker',label));
   const bubble=textNode('div','chat-bubble','');if(turn.voiceDuration)bubble.append(textNode('div','chat-voice-message',`语音转文字 · ${turn.voiceDuration} 秒`));if(turn.text)bubble.append(textNode('span','chat-message-text',turn.text));
   if(Array.isArray(turn.imageThumbs)&&turn.imageThumbs.length){const gallery=textNode('div','chat-message-gallery','');gallery.classList.toggle('chat-gallery-many',turn.imageThumbs.length>4);if(turn.imageThumbs.length>4)gallery.tabIndex=0;gallery.setAttribute('aria-label',`${turn.imageThumbs.length} 张图片，滚动查看`);for(const [index,thumb]of turn.imageThumbs.entries()){const tile=textNode('figure','chat-message-tile','');if(thumb){const img=document.createElement('img');img.src=thumb;img.decoding='async';img.alt=`本机保留的第 ${index+1} 张账单缩略图`;img.className='chat-message-image';tile.append(img);}else tile.append(textNode('span','chat-image-omitted',`图 ${index+1} 未保留`));tile.append(textNode('figcaption','',`图 ${index+1}`));gallery.append(tile);}bubble.append(gallery);}
   else if(turn.imageThumb){const img=document.createElement('img');img.src=turn.imageThumb;img.alt='本机保留的账单缩略图';img.className='chat-message-image';bubble.append(img);}else if(turn.imageOmitted)bubble.append(textNode('small','chat-turn-failed','这张图片未保留，文字与记账结果仍可查看。'));
   if(Array.isArray(turn.imageResults)&&turn.imageResults.length)bubble.append(renderImageResults(turn,{readOnly}));
   if(turn.failed)bubble.append(textNode('small','chat-turn-failed','这次未完成；请以账单卡片和流水中的记录为准。'));row.append(bubble);for(const card of turn.cards||[])row.append(renderCard(card,{readOnly}));log.append(row);
  }
 }
 function render(){
  const log=$('chat-messages');log.replaceChildren();
  if(!turns.length){const empty=document.createElement('div');empty.className='chat-empty';empty.innerHTML=sticker('book','chat-empty-cat');empty.append(textNode('h2','','发来这笔账，我来整理'),textNode('p','','发一句话或付款截图。信息明确就直接记下，拿不准的我会再问你。'));const examples=document.createElement('div');examples.className='chat-examples';for(const value of['午饭 28，地铁 6','昨天买书花了 45 元','工资到账 5000']){const button=textNode('button','',value);button.type='button';button.dataset.chatExample=value;examples.append(button);}empty.append(examples);log.append(empty);}
  if(turns.length)renderTurns(log,turns,{readOnly:historyReadOnly});
  if(busy){const thinking=textNode('article','chat-turn chat-turn-assistant chat-thinking','');thinking.append(textNode('div','chat-bubble',saving?'正在记入账本…':'正在识别这条消息…'));log.append(thinking);}
  syncControls();scrollBottom();
 }
 function renderCard(card,{readOnly=false}={}){
  if(readOnly){card={...card,draft:{...card.draft}};const record=isLedgerReady()?getRecord(card.id):null;if(record){card.draft={...card.draft,...record};card.state='saved';card.savedOnce=true;card.notice='';card.manualReview=false;}else if(card.savedOnce&&isLedgerReady()){card.state='undone';card.notice='这笔账目已删除或撤销，目前不在流水中。';}else if(!isLedgerReady())card.notice='账本尚未就绪，保存状态待核对。';}
  const node=document.createElement('section');node.className=`chat-card chat-card-${card.state}`;node.dataset.cardId=card.id;
  const top=document.createElement('div');top.className='chat-card-top';const art=document.createElement('span');art.className='chat-card-sticker';art.innerHTML=recordSticker(card.draft);const amount=textNode('strong','chat-card-amount',card.draft.amountCents==null?'金额待补':formatMoney(card.draft.amountCents));const heading=document.createElement('div');heading.append(textNode('small','',TYPES[card.draft.type]||'收支待核对'),amount);top.append(art,heading);node.append(top);
  if(Number.isInteger(card.draft.imageIndex))node.append(textNode('small','chat-card-source',`来自图 ${card.draft.imageIndex}`));
  node.append(textNode('h3','chat-card-merchant',card.draft.merchant||'商户 / 用途待补'));
  const meta=document.createElement('div');meta.className='chat-card-meta';for(const value of[card.draft.category,card.draft.purpose,card.draft.channel!=='其他'?card.draft.channel:''].filter(Boolean))meta.append(textNode('span','',value));node.append(meta);
  node.append(textNode('p','chat-card-date',card.draft.date?card.draft.date.replace('T',' '):'日期没有读到，请核对'));
  if(card.notice)node.append(textNode('p','chat-card-warning',card.notice));
  if(card.draft.notes)node.append(textNode('p','chat-card-note',card.draft.notes));
  const actions=document.createElement('div');actions.className='chat-card-actions';const notice=textNode('span','chat-card-state','');
  if(readOnly){notice.textContent=!isLedgerReady()?'保存状态待核对':card.state==='saved'?'已记下 · 当前仍在流水中':card.savedOnce?'已删除或撤销':card.state==='cancelled'?'当时已取消':card.state==='replaced'?'已由后续补充更新':'当时待核对，未入账';actions.append(notice);node.append(actions);return node;}
  const edit=textNode('button','text-button','修改');edit.type='button';edit.dataset.chatEdit=card.id;
  const save=textNode('button','button primary',needsAttention(card.draft)||card.manualReview?'补全并核对':'记下');save.type='button';save.dataset.chatSave=card.id;
  if(card.state==='saved'){notice.textContent='已记下';save.hidden=true;}
  else if(card.state==='replaced'||card.state==='cancelled'){notice.textContent=card.state==='cancelled'?'已取消':'已由后续补充更新';save.hidden=true;edit.hidden=true;edit.dataset.locked='true';}
  else if(card.state==='undone'){notice.textContent='已撤销';save.textContent=needsAttention(card.draft)?'补全并核对':'重新记下';}
  else{notice.textContent=needsAttention(card.draft)?'有信息需要补全':'待确认';}
  actions.append(notice,edit,save);if(card.state==='saved'&&getUndoableId?.()===card.id){const undo=textNode('button','text-button','撤销');undo.type='button';undo.dataset.chatUndo=card.id;actions.append(undo);}node.append(actions);return node;
 }
 function activeImage(){return images.find(item=>item.id===activeImageId)||null;}
 function imageBytes(data){if(!data)return 0;const encoded=data.slice(data.indexOf(',')+1);return encoded.length*3/4-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);}
 function releaseActivePhoto(){if(image)image.src='';image=null;if(imageURL)URL.revokeObjectURL(imageURL);imageURL='';}
 function renderAttachments(){
  $('chat-attachment').hidden=!images.length;$('chat-attachment').dataset.count=String(images.length);
  const current=activeImage(),index=images.findIndex(item=>item.id===activeImageId);
  imageDataUrl=current?.data||'';imageThumb=current?.thumb||'';
  if(imageDataUrl||imageThumb)$('chat-image-preview').src=imageDataUrl||imageThumb;else $('chat-image-preview').removeAttribute('src');
  $('chat-image-preview').alt=`本次第 ${index+1} 张账单图片`;
  $('chat-image-label').textContent=images.length>1?`已选 ${images.length} / ${IMAGE_LIMITS.count} 张 · 当前图 ${index+1}`:`已选 1 / ${IMAGE_LIMITS.count} 张图片`;
  $('chat-image-crop-label').textContent=images.length>1?`检查 / 裁剪第 ${index+1} 张`:'检查 / 裁剪图片';
  $('chat-image-crop').hidden=!current;$('chat-image-list').hidden=images.length<=1;
  const list=$('chat-image-list'),scrollLeft=list.scrollLeft;list.replaceChildren();
  for(const [position,item]of images.entries()){
   const tile=textNode('div','chat-image-item','');tile.dataset.imageId=item.id;
   const select=textNode('button','chat-image-select','');select.type='button';select.dataset.imageSelect=item.id;select.setAttribute('aria-label',`选择第 ${position+1} 张图片，检查或裁剪`);select.setAttribute('aria-pressed',String(item.id===activeImageId));
   const thumb=document.createElement('img');thumb.src=item.thumb;thumb.decoding='async';thumb.alt=`图 ${position+1}`;thumb.className='chat-attachment-thumb';select.append(thumb,textNode('span','chat-image-number',String(position+1)));
   const remove=textNode('button','chat-image-remove','×');remove.type='button';remove.dataset.imageRemove=item.id;remove.setAttribute('aria-label',`移除第 ${position+1} 张图片`);
   tile.append(select,remove);list.append(tile);
  }
  list.scrollLeft=scrollLeft;syncControls();requestAnimationFrame(fitViewport);
 }
 function releaseImage(){imageRun++;imagePreparing=false;releaseActivePhoto();images=[];activeImageId='';imageDataUrl='';imageThumb='';$('chat-image-preview').removeAttribute('src');$('chat-attachment').hidden=true;$('chat-attachment').dataset.count='0';$('chat-image-list').replaceChildren();$('chat-image-crop').hidden=true;$('chat-image-crop').open=false;$('chat-file').value='';for(const edge of['top','left'])$('chat-crop-'+edge).value='0';for(const edge of['bottom','right'])$('chat-crop-'+edge).value='100';for(const input of host.querySelectorAll('.chat-crop-grid input'))input.disabled=true;}
 function makeJPEG(photo,left,top,right,bottom,maxEdge,maxPixels,quality){
  const x=Math.floor(photo.naturalWidth*left/100),y=Math.floor(photo.naturalHeight*top/100),width=Math.floor(photo.naturalWidth*(right-left)/100),height=Math.floor(photo.naturalHeight*(bottom-top)/100);
  const scale=Math.min(1,maxEdge/Math.max(width,height),Math.sqrt(maxPixels/(width*height)));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));const context=canvas.getContext('2d');if(!context)throw new Error();context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(photo,x,y,width,height,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',quality);canvas.width=canvas.height=1;return data;
 }
 async function decodePhoto(file){const url=URL.createObjectURL(file),photo=new Image();let timer;photo.decoding='async';photo.src=url;try{await Promise.race([photo.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error()),12000);})]);if(!photo.naturalWidth||photo.naturalWidth*photo.naturalHeight>32000000)throw new Error();return{photo,url};}catch{photo.src='';URL.revokeObjectURL(url);throw new Error();}finally{clearTimeout(timer);}}
 function imageStatus(){const support=getImageSupport(getService());status(support.supported===false?IMAGE_BLOCKED_MESSAGE:`已准备 ${images.length} 张图片，点“发送”一起识别。${images.length>4?'图片较多，识别可能需要更长时间。':''}`,support.supported===false?'error':'');}
 function crop(){
  const current=activeImage();if(!current||!image||imagePreparing)return;
  current.data='';imageDataUrl='';
  const bounds=['left','top','right','bottom'].map(edge=>Number($('chat-crop-'+edge).value)),[left,top,right,bottom]=bounds;
  if(!bounds.every(Number.isFinite)||left<0||top<0||right>100||bottom>100||right-left<2||bottom-top<2){status('裁剪至少保留 2%，右边需大于左边，下边需大于上边。','error');updatePayload();return;}
  try{const data=makeJPEG(image,left,top,right,bottom,1600,1600000,.88);if(imageBytes(data)>IMAGE_LIMITS.each||images.reduce((total,item)=>total+(item.id===current.id?0:imageBytes(item.data)),0)+imageBytes(data)>IMAGE_LIMITS.total)throw new Error();current.data=data;current.thumb=makeJPEG(image,left,top,right,bottom,320,100000,.72);current.bounds=bounds;renderAttachments();imageStatus();}catch{status('图片过大或暂时无法准备，请缩小裁剪范围，或减少图片后重试。','error');}
  updatePayload();
 }
 async function selectImage(id,{announce=true}={}){
  const current=images.find(item=>item.id===id);if(!current||busy||saving)return;
  const run=++imageRun;releaseActivePhoto();activeImageId=id;imagePreparing=true;
  for(const [index,edge]of['left','top','right','bottom'].entries())$('chat-crop-'+edge).value=String(current.bounds[index]);
  renderAttachments();if(announce)status(`正在准备第 ${images.indexOf(current)+1} 张图片，尚未发送。`);
  try{const decoded=await decodePhoto(current.file);if(run!==imageRun){decoded.photo.src='';URL.revokeObjectURL(decoded.url);return;}image=decoded.photo;imageURL=decoded.url;imagePreparing=false;renderAttachments();if(announce)imageStatus();}
  catch{if(run!==imageRun)return;imagePreparing=false;status('原图暂时无法重新打开。已准备的图片可发送，若需裁剪请移除后重选。','error');syncControls();}
  updatePayload();
 }
 async function chooseImages(selection){
  const files=Array.from(selection||[]);if(!files.length||busy||saving||imagePreparing)return;
  if(images.length+files.length>IMAGE_LIMITS.count){status(`一次最多选择 ${IMAGE_LIMITS.count} 张图片。原有图片已保留，请减少本次选择。`,'error');return;}
  if(files.some(file=>file.size>20*1024*1024||!['image/png','image/jpeg','image/webp','image/bmp'].includes(file.type))){status('本次未添加图片。请选择每张不超过 20MB 的 PNG、JPEG、WebP 或 BMP 图片。','error');return;}
  const run=++imageRun,staged=[];imagePreparing=true;releaseActivePhoto();syncControls();let failure='',preparedBytes=images.reduce((total,item)=>total+imageBytes(item.data),0);
  try{for(const [index,file]of files.entries()){
   status(`正在本机准备图片 ${index+1} / ${files.length}，尚未发送。`);
   const decoded=await decodePhoto(file);try{if(run!==imageRun)return;const data=makeJPEG(decoded.photo,0,0,100,100,1600,1600000,.88),bytes=imageBytes(data);if(bytes>IMAGE_LIMITS.each)throw new Error();if(preparedBytes+bytes>IMAGE_LIMITS.total){failure=`本次压缩后的图片合计超过 ${IMAGE_LIMITS.total/1024/1024}MB。原有图片已保留，请减少本次选择。`;throw new Error();}preparedBytes+=bytes;staged.push({id:newId(),file,data,thumb:makeJPEG(decoded.photo,0,0,100,100,320,100000,.72),bounds:[0,0,100,100]});}finally{decoded.photo.src='';URL.revokeObjectURL(decoded.url);}
   await new Promise(resolve=>setTimeout(resolve,0));if(run!==imageRun)return;
  }
  if(images.concat(staged).reduce((total,item)=>total+imageBytes(item.data),0)>IMAGE_LIMITS.total){failure=`本次压缩后的图片合计超过 ${IMAGE_LIMITS.total/1024/1024}MB。原有图片已保留，请减少本次选择。`;throw new Error();}
  if(run!==imageRun)return;images.push(...staged);imagePreparing=false;await selectImage(staged[0].id,{announce:false});if(run+1!==imageRun)return;imageStatus();
  }catch{if(run!==imageRun)return;imagePreparing=false;status(failure||'本次图片未添加，有图片无法读取或处理。原有图片已保留，请分批重选。','error');if(images.length)await selectImage(activeImageId||images[0].id,{announce:false});}
  updatePayload();requestAnimationFrame(fitViewport);
 }
 async function removeImage(id){if(busy||saving||imagePreparing)return;const position=images.findIndex(item=>item.id===id);if(position<0)return;images.splice(position,1);if(!images.length){releaseImage();updatePayload();status('已移除本次图片。');return;}if(activeImageId===id)await selectImage(images[Math.min(position,images.length-1)].id,{announce:false});else renderAttachments();updatePayload();status(`已移除该图，剩余 ${images.length} 张。`);}
 function stopRequest(message=SAFE_ERRORS.ABORTED){if(busy){const last=turns.at(-1);if(last?.role==='user')last.failed=true;}requestRun++;controller?.abort();controller=null;busy=false;status(message);syncControls();persistHistory();}
 function safeError(error){const code=String(error?.code||'').toUpperCase();return SAFE_ERRORS[code]||({HOST:SAFE_ERRORS.CONFIG,KEY:SAFE_ERRORS.AUTH,PAYLOAD:SAFE_ERRORS.RESPONSE,MODE:SAFE_ERRORS.CONFIG,CANCELLED:SAFE_ERRORS.ABORTED,RATE:SAFE_ERRORS.RATE_LIMIT,SIZE:SAFE_ERRORS.RESPONSE,SERVER:SAFE_ERRORS.RESPONSE,REDIRECT:SAFE_ERRORS.NETWORK,SESSION_CHANGED:SAFE_ERRORS.SESSION})[code]||SAFE_ERRORS.RESPONSE;}
 function newCard(draft){const id=newId();return{id,state:'pending',savedOnce:false,draft:{...draft,id,source:'ai',status:'pending'}};}
 function replacePending(drafts,text){
  const previous=pendingCards();if(fingerprint(previous.map(card=>card.draft))===fingerprint(drafts))return[];
  if(!drafts.length&&previous.length&&!/不记|取消|删掉|删除|不要.*记/.test(text))return[];
  for(const card of previous)card.state=drafts.length?'replaced':'cancelled';
  return drafts.map(newCard);
 }
 function clearSendPreview(){const first=$('chat-send-image');first.hidden=true;first.removeAttribute('src');$('chat-send-images').replaceChildren(first);}
 function requestConsent(){consentSignature=JSON.stringify(expectedService());const service=getService();$('chat-send-target').textContent=`发送到 ${service.endpoint}\n模型：${service.model}${images.length?`\n本次图片：${images.length} 张`:'（仅文字）'}`;clearSendPreview();for(const [index,item]of images.entries()){const img=index?document.createElement('img'):$('chat-send-image');img.src=item.thumb;img.decoding='async';img.alt=`即将发送的第 ${index+1} 张图片缩略预览`;img.hidden=false;if(index)$('chat-send-images').append(img);}$('chat-send-dialog').showModal();}
 async function send(event){
  event?.preventDefault?.();refreshService();if(historyLoading||historyWriting||historyReadOnly||busy||saving)return;
  if(voiceUI?.hasUnsavedWork()){status('请先松开或取消语音，再发送。');return;}
  const service=getService()||{},text=$('chat-input').value.trim();
  if(!service.configured||!service.hasKey){status('先配置自己的接口与密钥。消息会保留。','error');$('chat-service-details').open=true;return;}
  if(imagePreparing||(!text&&!images.length))return;
  if(images.some(item=>!item.data)){status('有图片尚未准备好，请调整对应图片的裁剪或重新选图。','error');return;}
  const support=getImageSupport(service);if(images.length&&support.supported===false){status(IMAGE_BLOCKED_MESSAGE,'error');return;}
  if(!navigator.onLine){status('当前离线，AI 需要网络。消息仍保留。','error');return;}
  if(!$('chat-consent').checked){requestConsent();return;}
  if(turns.length>=64){status('请先处理待核对账单，再点“新对话”。','error');return;}
  if(!pendingCards().length&&allCards().some(card=>card.savedOnce)&&/^(?:刚才|上一笔|上笔|这笔|那笔|修改|改成|更正).*(?:改|不是|是|成|\d)/.test(text)){turns.push({role:'assistant',at:new Date().toISOString(),text:'已记下的账单请点卡片“修改”，我会更正原记录。'});render();persistHistory();status('这条提示在本机生成。');return;}
  if(!payloadEdited)updatePayload();const payload=$('chat-payload').value.trim();if(!payload||payload.length>AI_LIMITS.previewChars){status('消息内容为空或过长，请修改后再发送。','error');return;}
  const selected=expectedService(),sentImages=images.map(item=>item.data),sentThumbs=images.map(item=>item.thumb),autoSave=$('chat-auto-save').checked,voice=pendingVoice;pendingVoice=null;
  const run=++requestRun;controller=new AbortController();const signal=controller.signal;busy=true;
  const userTurn={role:'user',at:new Date().toISOString(),text:sanitizeHistoryText(text||(sentImages.length?'':'请帮我记账')),...(sentThumbs.length>1?{imageThumbs:sentThumbs}:sentThumbs.length?{imageThumb:sentThumbs[0]}:{}),voiceDuration:voice?.durationSeconds};turns.push(userTurn);render();status('');await persistHistory();if(run!==requestRun||signal.aborted)return;
  try{
   const result=await request({payload,...(sentImages.length>1?{imageDataUrls:sentImages}:sentImages.length?{imageDataUrl:sentImages[0]}:{}),signal,expectedService:selected});if(run!==requestRun||signal.aborted)return;
   const drafts=Array.isArray(result?.drafts)?result.drafts:[],cards=replacePending(drafts,text),answer={role:'assistant',...(sentImages.length>1?{imageResults:safeImageResults(result?.imageResults,sentImages.length)}:{}),text:cards.length?'正在整理账单…':'本次没有新增账目。'+(pendingCards().length?'待核对卡片仍在上方。':'')+explainNoDrafts(result?.reply),cards};turns.push(answer);
   await persistHistory();if(run!==requestRun||signal.aborted)return;$('chat-input').value='';releaseImage();payloadEdited=false;resizeInput();
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
   if(sentImages.length>1)answer.text=`已处理 ${sentImages.length} 张图片，${saved?`实际记下 ${saved} 笔。`:'本次未新增账目。'}${pending?`${pending} 笔待核对。`:''}每张图片的处理结果如下。`;
   const reviewImages=(answer.imageResults||[]).filter(row=>{const linked=cards.filter(card=>card.draft.imageIndex===row.imageIndex);return row.status!=='identified'||!linked.length||linked.some(card=>card.state!=='saved');}).length;
   status(sentImages.length>1&&reviewImages?`${sentImages.length} 张已处理，${reviewImages} 张需核对，请上滑查看逐图结果。`:'');
  }catch(error){if(run!==requestRun)return;userTurn.failed=true;const message=sentImages.length&&['RESPONSE','IMAGE'].includes(String(error?.code||'').toUpperCase())?(sentImages.length>1?'这批图片暂时无法整理成账单。请确认所选模型支持多图，或减少图片数量后再发送。':'这次图片未能识别，请检查所选模型是否支持图片；也可换张清晰截图。'):safeError(error);turns.push({role:'assistant',text:'这次没有新增账目。'+message});status(message,'error');}
  finally{persistHistory();if(savingOwner===run){saving=false;savingOwner=null;}if(run===requestRun){busy=false;controller=null;updatePayload();render();requestAnimationFrame(fitViewport);}}
 }
 async function saveCard(card){
  if(busy||saving||voiceUI?.hasUnsavedWork()||!['pending','undone'].includes(card.state))return;
  if(needsAttention(card.draft)||card.manualReview){onEdit({...card.draft});return;}
  saving=true;syncControls();status('正在记入本机账本……');
  try{const record=await onSave({...card.draft});if(record){card.draft={...card.draft,...record};card.state='saved';card.savedOnce=true;status('已记下，账目保存在本机。');}else status('已取消保存，卡片仍保留在这段对话中。');}
  catch{status('这次没有保存，请检查卡片；原内容仍保留。','error');}
  finally{saving=false;render();updatePayload();persistHistory();}
 }
 function syncSavedRecords(){if(!isLedgerReady())return;let changed=false;for(const card of allCards()){const record=getRecord(card.id);if(record){const next={...card.draft,...record};if(card.state!=='saved'||card.notice||card.manualReview||JSON.stringify(card.draft)!==JSON.stringify(next)){card.draft=next;card.state='saved';card.savedOnce=true;card.notice='';card.manualReview=false;changed=true;}}else if(card.savedOnce&&card.state==='saved'){card.state='undone';changed=true;}}if(changed){render();updatePayload();persistHistory();}historyUI?.refresh();}
 async function clearSession(){if(historyLoading||busy||saving||historyWriting)return;historyWriting=true;syncControls();await persistHistory();if(historyFailed&&!historyReadOnly&&turns.length){historyWriting=false;syncControls();status('这段聊天未能保留，请先处理存储问题，再开始新对话。','error');return;}historyGeneration++;pendingVoice=null;if($('chat-send-dialog').open)$('chat-send-dialog').close();voiceUI?.cancel({silent:true});voiceUI?.closeDialog();releaseImage();turns=[];freshConversation();historyWriting=false;payloadEdited=false;$('chat-input').value='';$('chat-api-key').value='';$('chat-consent').checked=false;updatePayload();render();historyState();status('新对话已准备，之前的对话可在“历史记录”查看。');}
 function confirmClear(){if(historyLoading||historyWriting||busy||saving)return;const hadVoice=Boolean(voiceUI?.hasUnsavedWork());voiceUI?.cancel({silent:true});if(historyReadOnly||(!turns.length&&!$('chat-input').value.trim()&&!images.length&&!imagePreparing&&!hadVoice)){clearSession();return;}$('chat-clear-dialog').showModal();}
 function sessionChanged(){if($('chat-send-dialog').open)$('chat-send-dialog').close();pendingVoice=null;voiceUI?.cancel({silent:true});if(busy)stopRequest(SAFE_ERRORS.SESSION);$('chat-api-key').value='';refreshService({reset:true});updatePayload();if(images.length){const support=getImageSupport(getService());status(support.supported===false?IMAGE_BLOCKED_MESSAGE:`${images.length} 张图片仍保留，请核对新接口与模型后点“发送”。`,support.supported===false?'error':'');}}
 $('chat-form').addEventListener('submit',send);
 function resizeInput(){$('chat-input').style.height='auto';$('chat-input').style.height=Math.min(80,Math.max(44,$('chat-input').scrollHeight))+'px';requestAnimationFrame(fitViewport);}
 $('chat-input').addEventListener('input',()=>{pendingVoice=null;resizeInput();updatePayload();});
 $('chat-input').addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();$('chat-form').requestSubmit();}});
 $('chat-consent').addEventListener('change',syncControls);
 $('chat-auto-save').addEventListener('change',()=>{$('chat-mode-label').textContent=$('chat-auto-save').checked?'自动记账 · 更多':'核对后记账 · 更多';});
 $('chat-send-dismiss').addEventListener('click',()=>{$('chat-send-dialog').close();clearSendPreview();});
 $('chat-send-accept').addEventListener('click',()=>{if(consentSignature!==JSON.stringify(expectedService())){$('chat-send-dialog').close();status(SAFE_ERRORS.SESSION,'error');return;}$('chat-consent').checked=true;$('chat-send-dialog').close();clearSendPreview();send();});
 $('chat-payload').addEventListener('input',()=>{payloadEdited=true;syncControls();});
 $('chat-add-image').addEventListener('click',()=>$('chat-file').click());$('chat-file').addEventListener('change',event=>{const files=Array.from(event.target.files||[]);event.target.value='';chooseImages(files);});
 $('chat-remove-image').addEventListener('click',()=>{releaseImage();updatePayload();status('已移除本次全部图片。');requestAnimationFrame(fitViewport);});
 $('chat-image-list').addEventListener('click',event=>{const remove=event.target.closest('[data-image-remove]'),select=event.target.closest('[data-image-select]');if(remove)removeImage(remove.dataset.imageRemove);else if(select&&!imagePreparing)selectImage(select.dataset.imageSelect);});for(const input of host.querySelectorAll('.chat-crop-grid input'))input.addEventListener('input',crop);
 $('chat-send-dialog').addEventListener('close',clearSendPreview);
 $('chat-cancel').addEventListener('click',()=>stopRequest());$('chat-clear').addEventListener('click',confirmClear);$('chat-clear-cancel').addEventListener('click',()=>$('chat-clear-dialog').close());$('chat-clear-confirm').addEventListener('click',()=>{$('chat-clear-dialog').close();clearSession();});
 $('chat-configure').addEventListener('click',onConfigure);
 $('chat-start-new').addEventListener('click',confirmClear);
 $('chat-fix-model').addEventListener('click',onConfigure);
 $('chat-use-key').addEventListener('click',()=>{const value=$('chat-api-key').value;$('chat-api-key').value='';try{setSessionKey(value);refreshService({reset:true});if(getService()?.hasKey){$('chat-service-details').open=false;status('密钥只在本次页面暂存。确认发送范围后，就可以开始。');}else status('请填写有效的本次密钥。','error');}catch{status('密钥格式不正确，请检查后重新填写。','error');}});
 $('chat-messages').addEventListener('click',event=>{if(voiceUI?.hasUnsavedWork())return;const undo=event.target.closest('[data-chat-undo]');if(undo){if(!busy&&!saving&&getUndoableId?.()===undo.dataset.chatUndo)onUndo?.();return;}const example=event.target.closest('[data-chat-example]');if(example){$('chat-input').value=example.dataset.chatExample;updatePayload();$('chat-input').focus();return;}const save=event.target.closest('[data-chat-save]'),edit=event.target.closest('[data-chat-edit]');const id=save?.dataset.chatSave||edit?.dataset.chatEdit,card=allCards().find(item=>item.id===id);if(!card||busy||saving)return;if(save)saveCard(card);else if(edit&&!['replaced','cancelled'].includes(card.state))onEdit({...((getRecord(card.id))||card.draft)});});
 window.addEventListener('qingji-ai-session',sessionChanged);
 window.addEventListener('pagehide',()=>{stopRequest('');persistHistory();pendingVoice=null;voiceUI?.cancel({silent:true});voiceUI?.closeDialog();releaseImage();$('chat-api-key').value='';$('chat-consent').checked=false;});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persistHistory();});
 window.addEventListener('storage',event=>{if(event.key===CLEAR_EPOCH&&event.newValue!==clearEpoch){clearEpoch=event.newValue||'';discardClearedHistory();historyUI?.refresh();}});
 function fitViewport(){if(!active)return;const viewport=window.visualViewport,height=viewport?.height||innerHeight,keyboard=height<innerHeight-100;document.body.classList.toggle('chat-keyboard-active',keyboard);host.style.setProperty('--chat-viewport-height',`${height}px`);const top=host.querySelector('.chat-shell').getBoundingClientRect().top,bottom=(viewport?.offsetTop||0)+height,nav=document.querySelector('.bottom-nav'),navRect=nav?.getBoundingClientRect();const edge=!keyboard&&navRect?.height?Math.min(bottom-8,navRect.top-8):bottom-6;host.style.setProperty('--chat-shell-height',`${Math.max(80,Math.floor(edge-top))}px`);}
 for(const details of host.querySelectorAll('details'))details.addEventListener('toggle',()=>requestAnimationFrame(fitViewport));
 $('chat-input').addEventListener('focus',()=>requestAnimationFrame(fitViewport));
 window.visualViewport?.addEventListener('resize',fitViewport);window.addEventListener('resize',fitViewport);
 voiceUI=createVoiceUI({host,input:$('chat-input'),onChange:syncControls,onStatus:status,onSend:voice=>{pendingVoice=voice;send();}});
 historyUI=createChatHistoryUI({host,store:historyStore,getCurrentId:()=>historyReadOnly?'':conversationId,renderTurns,onBeforeOpen:async()=>{if(historyLoading||historyWriting||busy||saving||voiceUI.hasUnsavedWork()){status('请先结束当前语音或记账处理，再查看聊天记录。','error');return false;}await persistHistory();return true;},onAfterClear:()=>{historyGeneration++;turns=[];freshConversation();historyFailed=false;payloadEdited=false;$('chat-consent').checked=false;clearEpoch=newId();try{localStorage.setItem(CLEAR_EPOCH,clearEpoch);}catch{clearEpoch=null;}updatePayload();render();historyState('聊天记录已清空，账本保留。');}});
 $('chat-history').addEventListener('click',()=>historyUI.open());
 refreshService();updatePayload();render();const ready=restoreHistory();
 return{ready,setActive(value){active=Boolean(value);document.body.classList.toggle('chat-active',active);if(!active){if(busy)stopRequest('已停止本次处理，已保存的账目保留。');if($('chat-send-dialog').open)$('chat-send-dialog').close();voiceUI.cancel({silent:true});voiceUI.closeDialog();historyUI.close();document.body.classList.remove('chat-keyboard-active');}refreshService();if(active){syncSavedRecords();fitViewport();requestAnimationFrame(fitViewport);scrollBottom();}},hasUnsavedWork:()=>Boolean(historyLoading||historyWriting||busy||saving||voiceUI.hasUnsavedWork()||imagePreparing||images.length||$('chat-input').value.trim()||$('chat-api-key').value||pendingCards().length),syncSavedRecords,clear:confirmClear,isBusy:()=>historyLoading||historyWriting||busy||saving||voiceUI.isActive()||historyUI.isBusy()};
}
