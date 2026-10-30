import{createVoiceInput}from'./voice-input.js';
import{icon}from'./icons.js';

const ERRORS={unsupported:'当前浏览器不支持直接语音识别，请切回文字，使用 iPhone 键盘的麦克风听写。','not-allowed':'未获得麦克风或语音识别权限。请检查浏览器权限，或使用键盘听写。','service-not-allowed':'系统语音识别暂不可用。可检查 Siri 和语音权限，或使用键盘听写。',network:'语音识别连接失败。已确认的文字会保留，请检查后手动发送。','no-speech':'没有听到清楚的内容，请重新按住说话。','audio-capture':'麦克风暂不可用，请检查权限或其他应用是否正在使用。','language-not-supported':'当前语音服务不支持中文，请使用键盘听写或打字。',aborted:'本次语音已取消，原输入保留。','start-failed':'无法启动语音识别，请使用键盘听写，或在 Safari 中重试。',timeout:'语音识别等待超时，已停止。已确认的文字会保留，请检查后发送。'};
const keyboardIcon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h1m4 0h1m4 0h1M6 12h1m4 0h1m4 0h1M7 16h10"/></svg>';
// This remembers the app explanation only. Browser/OS microphone and speech
// permission remains under the user's control and is never inferred here.
const DISCLOSURE_KEY='qingji-voice-disclosure-v1';
function readAcknowledgement(){try{return localStorage.getItem(DISCLOSURE_KEY)==='1';}catch{return false;}}
function rememberAcknowledgement(){try{localStorage.setItem(DISCLOSURE_KEY,'1');return true;}catch{return false;}}

/** Hold-to-speak input. The browser owns speech processing; this view holds
 * text only. No microphone file, playback control, credential or direct AI call. */
export function createVoiceUI({host,input,onChange,onStatus,onSend}){
 const $=id=>host.querySelector('#'+id);
 const toggle=document.createElement('button');toggle.id='chat-voice';toggle.type='button';toggle.className='chat-voice-button';toggle.setAttribute('aria-controls','chat-voice-hold');input.before(toggle);
 const hold=document.createElement('button');hold.id='chat-voice-hold';hold.type='button';hold.className='chat-voice-hold';hold.hidden=true;hold.setAttribute('aria-describedby','chat-voice-hint');input.after(hold);
 const panel=document.createElement('div');panel.id='chat-voice-panel';panel.className='voice-panel';panel.hidden=true;
 panel.innerHTML='<div class="voice-state-row"><strong id="chat-voice-state" role="status" aria-live="polite">按住说话</strong><span id="chat-voice-time" aria-hidden="true">0:00 / 1:00</span></div><p id="chat-voice-live"></p><p id="chat-voice-hint">松开发送，上滑取消。语音会转成文字，不保存录音。</p><div class="voice-panel-actions"><button id="chat-voice-apply" type="button" class="button secondary" hidden>填入文字</button><button id="chat-voice-cancel" type="button" class="text-button">取消本次</button></div>';
 input.closest('form').append(panel);
 const fallback=document.createElement('p');fallback.id='chat-voice-fallback';fallback.hidden=true;fallback.setAttribute('role','status');input.closest('form').append(fallback);
 const tools=document.createElement('div');tools.id='chat-voice-tools';tools.className='voice-tools';tools.hidden=true;tools.innerHTML='<button id="chat-voice-dictate" type="button" class="text-button">改用键盘听写</button><details id="chat-voice-diagnostics"><summary>识别状态</summary><div class="voice-diagnostics-body"><p id="chat-voice-events"></p><p>此面板只含事件状态，不含转写正文、录音或密钥；诊断信息仅本次显示。</p></div></details>';input.closest('form').append(tools);
 const dialog=document.createElement('dialog');dialog.id='chat-voice-dialog';dialog.className='sheet-dialog small-dialog';dialog.setAttribute('aria-labelledby','chat-voice-dialog-title');
 dialog.innerHTML='<h2 id="chat-voice-dialog-title">按住说话，松开发送</h2><p>你说的话由浏览器或系统的语音服务识别，可能需要联网。轻记不保存录音，也不把录音发给你配置的 AI。</p><p>正常松手后，会把识别文字提交给当前选定的 AI 接口，可能产生调用费用。向上滑动可以取消。最长 60 秒；识别未完成时，候选文字只填入输入框，核对后手动发送。</p><p>这段说明只提示一次；麦克风和语音识别权限仍由 iPhone 或浏览器管理。<a class="text-link" href="./help.html#voice-permission" target="_blank" rel="noreferrer">查看权限设置 ↗</a></p><div class="dialog-actions"><button id="chat-voice-dismiss" type="button" class="button secondary">先不用</button><button id="chat-voice-start" type="button" class="button primary">知道了，去说话</button></div>';
 host.append(dialog);
 let acknowledged=readAcknowledgement(),blocked=false,voiceMode=false,take=null,pendingText='',voice=null,timer=null,startupTimer=null,noResultTimer=null,sequence=0,suppressClickUntil=0,keyboardGuide=false;
 let diagnosis=null,diagnosisFrame=0;
 const changed=()=>{try{onChange?.();}catch{}};
 const message=(text,kind='')=>onStatus?.(text,kind);
 const active=()=>Boolean(take);
 function clearTimers(){clearInterval(timer);clearTimeout(startupTimer);clearTimeout(noResultTimer);timer=null;startupTimer=null;noResultTimer=null;}
 function positionDiagnosis(){if(!$('chat-voice-diagnostics').open||diagnosisFrame)return;diagnosisFrame=requestAnimationFrame(()=>{diagnosisFrame=0;if(!$('chat-voice-diagnostics').open)return;const body=host.querySelector('.voice-diagnostics-body'),form=input.closest('form'),bounds=form.getBoundingClientRect(),actions=host.querySelector('.chat-composer-actions').getBoundingClientRect();if(bounds.top>=72){body.style.position='absolute';body.style.top='auto';body.style.bottom='calc(100% + 8px)';body.style.right='8px';body.style.maxHeight=Math.min(180,Math.max(44,bounds.top-16))+'px';}else{body.style.position='fixed';body.style.top='8px';body.style.bottom='auto';body.style.right=Math.max(8,innerWidth-bounds.right+8)+'px';body.style.maxHeight=Math.min(180,Math.max(44,actions.top-16))+'px';}});}
 function renderDiagnosis(){const d=diagnosis;$('chat-voice-events').textContent=d?`服务启动：${d.started?'是':'未报告'}；音频输入：${d.audio?'已报告':'未报告'}；检测语音：${d.speech?'已报告':'未报告'}；文字结果：${d.results} 次；最终文字：${d.final?'有':'无'}；临时文字：${d.interim?'有':'无'}；结束：${d.ended?'是':'否'}${d.error?'；错误：'+d.error:''}`:'还没有开始本次识别。';positionDiagnosis();}
 function suppressPhysicalClick(){suppressClickUntil=Date.now()+1200;}
 function clearControlSelection(){const selection=globalThis.getSelection?.();if(selection&&(hold.contains(selection.anchorNode)||toggle.contains(selection.anchorNode)))selection.removeAllRanges();}
 function setMode(value){voiceMode=Boolean(value);host.classList.toggle('chat-voice-mode',voiceMode);input.hidden=voiceMode;hold.hidden=!voiceMode;renderControls();}
 function renderControls(){
  toggle.disabled=blocked||active();toggle.setAttribute('aria-pressed',String(voiceMode));toggle.setAttribute('aria-label',voiceMode?'切换到文字输入':'切换到按住说话');toggle.innerHTML=(voiceMode?keyboardIcon:icon('mic'))+'<span class="voice-toggle-label">'+(voiceMode?'键盘':'语音')+'</span>';
  hold.disabled=blocked||Boolean(take&&!take.pressed);hold.textContent=take?(take.startupInterrupted?'等待系统授权…':take.cancelArmed?'松开取消':take.needsReview?'松手后核对':take.ended?'松开发送':voice?.getState()==='starting'?'正在开启…':take.pressed?'松开发送':'正在识别…'):'按住说话';
  hold.setAttribute('aria-label',take?.source==='assistive'?'轻点结束并发送':'按住说话，松开发送，向上滑动取消；也可按住空格或回车');hold.classList.toggle('is-holding',Boolean(take?.pressed));hold.classList.toggle('is-cancelling',Boolean(take?.cancelArmed));panel.classList.toggle('is-cancelling',Boolean(take?.cancelArmed));
  $('chat-voice-apply').hidden=active()||!pendingText;$('chat-voice-cancel').textContent=active()?'取消本次':pendingText?'放弃这段':'关闭';
  tools.hidden=keyboardGuide||(!voiceMode&&fallback.hidden);$('chat-voice-dictate').disabled=blocked;$('chat-voice-diagnostics').hidden=!diagnosis;
 }
 function transcript(){
  const finalText=take?.needsReview?take.reviewText:take?.finalText||pendingText,interim=take?.needsReview?'':take?.interimText||'';$('chat-voice-live').replaceChildren();
  if(finalText){const node=document.createElement('span');node.textContent=finalText;$('chat-voice-live').append(node);}
  if(interim){const node=document.createElement('span');node.className='voice-interim';node.textContent=(finalText?' ':'')+interim;$('chat-voice-live').append(node);}
  if(!finalText&&!interim)$('chat-voice-live').textContent='例如：今天午饭二十八元，地铁六元。';
 }
 function fill(text){
  const before=input.value,separator=before&&!/[\s，,；;。.!！?？]$/.test(before)?'，':'';const combined=before+separator+text,limit=input.maxLength>0?input.maxLength:2000;
  if(combined.length>limit){pendingText=text;setMode(false);panel.hidden=false;$('chat-voice-state').textContent='输入框已满，语音未填入';transcript();message('原输入和识别文字都已保留。请缩短输入，再点“填入文字”。','error');renderControls();changed();return false;}
  input.value=combined;pendingText='';input.dispatchEvent(new Event('input',{bubbles:true}));panel.hidden=true;renderControls();changed();return true;
 }
 function finish(){
  const current=take;if(!current||!current.ended||current.pressed)return;
  take=null;clearTimers();const finalText=(current.needsReview?current.reviewText:current.finalText).trim();panel.hidden=true;
  if(current.cancelled){renderControls();changed();return;}
  if(current.startupInterrupted){
   // A permission sheet may interrupt the finger gesture. Its eventual grant
   // is never a release-to-send gesture, nor a reason to start another session.
   if(current.errorCode){setMode(false);fallback.hidden=false;fallback.textContent=ERRORS[current.errorCode]||ERRORS['start-failed'];message(fallback.textContent,'error');}
   else{fallback.hidden=true;message('权限处理已结束，请重新按住“按住说话”，说完再松手。');}
   renderControls();changed();return;
  }
  if(!finalText){setMode(false);fallback.hidden=false;const tooShort=Date.now()-current.pressAt<500&&(!current.errorCode||current.errorCode==='no-speech');fallback.textContent=tooShort?'说话时间太短，请按住说完后再松手。':current.errorCode&&current.errorCode!=='no-speech'?ERRORS[current.errorCode]||ERRORS['start-failed']:'浏览器没有返回识别文字。可点“改用键盘听写”，再点 iPhone 键盘上的麦克风说话。';message(fallback.textContent,'error');renderControls();changed();return;}
  if(!fill(finalText))return;
  if(current.needsReview){setMode(false);fallback.hidden=false;fallback.textContent='这段是尚未确认的识别文字，已放进输入框。请核对金额和内容后再点“发送”。';message(fallback.textContent);renderControls();changed();return;}
  if(current.errorCode||current.endReason!=='ended'||!current.releaseRequested){setMode(false);fallback.hidden=false;fallback.textContent=ERRORS[current.errorCode]||'语音已转成文字，尚未发送。请检查后点发送。';message(fallback.textContent,'error');renderControls();changed();return;}
  fallback.hidden=true;renderControls();changed();
  const seconds=Math.max(1,Math.min(60,Math.ceil(((current.endedAt||Date.now())-(current.listenAt||current.pressAt))/1000)));
  message('语音已转成文字，正在提交这条消息…');
  const submitted=input.value,sendFailed=()=>{if(sequence!==current.id||take||input.value!==submitted)return;setMode(false);message('语音文字已保留，请检查后重新发送。','error');};
  try{Promise.resolve(onSend?.({text:submitted,durationSeconds:seconds})).catch(sendFailed);}catch{sendFailed();}
 }
 voice=createVoiceInput({language:'zh-CN',maxDurationMs:60000,stopTimeoutMs:10000,onActivity:event=>{
  if(!diagnosis)return;
  if(event.type==='start')diagnosis.started=true;
  else if(event.type==='audiostart'){diagnosis.audio=true;if(take&&!take.startupInterrupted)$('chat-voice-state').textContent='音频输入已启动，请说话';}
  else if(event.type==='speechstart'){diagnosis.speech=true;if(take&&!take.startupInterrupted)$('chat-voice-state').textContent='检测到语音，正在转成文字…';}
  else if(event.type==='result'){diagnosis.results=Math.min(256,diagnosis.results+1);diagnosis.final=Boolean(event.hasFinal);diagnosis.interim=Boolean(event.hasInterim);}
  else if(event.type==='end')diagnosis.ended=true;
  else if(event.type==='error')diagnosis.error=typeof event.code==='string'?event.code:'start-failed';
  renderDiagnosis();
 },onState:({state,reason})=>{
  if(!take)return;
  if(state==='starting'){$('chat-voice-state').textContent='正在开启语音识别…';panel.hidden=false;}
  else if(state==='listening'){clearTimeout(startupTimer);startupTimer=null;if(take.startupInterrupted){voice.cancel();return;}take.listenAt=Date.now();$('chat-voice-state').textContent=diagnosis?.speech?'检测到语音，正在转成文字…':diagnosis?.audio?'音频输入已启动，请说话':'语音服务已启动，等待文字…';const id=take.id;noResultTimer=setTimeout(()=>{if(!take||take.id!==id||take.finalText||take.interimText||take.reviewText||voice.getState()!=='listening')return;message('浏览器仍没有返回文字。可以松手后改用键盘听写。');$('chat-voice-state').textContent='尚未收到文字，可改用键盘听写';renderControls();},10000);}
  else if(state==='stopping'){$('chat-voice-state').textContent=reason==='limit'?'已到 60 秒，松开发送':'正在整理最后的文字…';}
  else if(state==='idle'){take.ended=true;take.endedAt=Date.now();take.endReason=reason;clearTimers();if(take.pressed){$('chat-voice-state').textContent=take.needsReview?'文字待核对，松手后检查':take.errorCode?'识别中断，松开后检查文字':take.finalText?'已收到确认文字，松开发送':'浏览器未返回文字，松手后改用键盘听写';renderControls();changed();return;}finish();return;}
  renderControls();changed();
 },onTranscript:result=>{if(!take||take.startupInterrupted)return;take.finalText=result.finalText;take.interimText=result.interimText;if(result.needsReview&&typeof result.reviewText==='string'){take.needsReview=true;take.reviewText=result.reviewText;}if(result.finalText||result.interimText||result.reviewText){clearTimeout(noResultTimer);noResultTimer=null;$('chat-voice-state').textContent=result.needsReview?'文字待核对':result.interimText?'文字正在确认，松手后核对':'已收到确认文字，松开发送';}transcript();},onError:({code})=>{if(!take)return;take.errorCode=code;fallback.textContent=ERRORS[code]||ERRORS['start-failed'];fallback.hidden=false;}});
 function cancel({silent=false}={}){
  suppressPhysicalClick();
  const hadWork=active()||Boolean(pendingText),previous=take;sequence++;take=null;pendingText='';clearTimers();voice.cancel();panel.hidden=true;
  if(previous?.pointerId!==undefined)try{hold.releasePointerCapture(previous.pointerId);}catch{}
  renderControls();changed();if(!silent&&hadWork)message('已取消本次语音，原输入保留。');
 }
 function begin(source,event){
  if(blocked){message('正在处理上一条消息，请稍后再说。');return false;}
  if(take)return false;
  if(pendingText){message('上一段语音还未填入，请先处理或放弃。');return false;}
  if(!voice.supported){setMode(false);fallback.textContent=ERRORS.unsupported;fallback.hidden=false;message(ERRORS.unsupported,'error');renderControls();changed();return false;}
  if(!acknowledged)acknowledged=readAcknowledgement();
  if(!acknowledged){message('请先点左侧语音按钮，阅读首次使用说明。');return false;}
  keyboardGuide=false;diagnosis={started:false,audio:false,speech:false,results:0,final:false,interim:false,error:'',ended:false};renderDiagnosis();
  const current={id:++sequence,source,pointerId:source==='pointer'?event.pointerId:undefined,startX:event?.clientX,startY:event?.clientY,bounds:source==='pointer'?hold.getBoundingClientRect():null,pressAt:Date.now(),listenAt:0,finalText:'',interimText:'',reviewText:'',needsReview:false,pressed:true,cancelArmed:false,ended:false,endReason:'',errorCode:'',releaseRequested:false,startupInterrupted:false};take=current;fallback.hidden=true;message('');$('chat-voice-time').textContent='0:00 / 1:00';transcript();
  const started=voice.start();
  if(!started){if(take===current){current.pressed=false;current.ended=true;current.errorCode=current.errorCode||'start-failed';finish();}return false;}
  timer=setInterval(()=>{if(!take)return;const seconds=Math.min(60,Math.floor((Date.now()-(take.listenAt||take.pressAt))/1000));$('chat-voice-time').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} / 1:00`;},1000);
  if(voice.getState()==='starting')startupTimer=setTimeout(()=>{if(!take||take.id!==current.id||voice.getState()!=='starting')return;take.errorCode='timeout';take.pressed=false;take.releaseRequested=false;voice.cancel();},45000);
  renderControls();changed();return true;
 }
 function isCancelPosition(event){const current=take;if(!current?.bounds)return false;return current.startY-event.clientY>=64||event.clientX<current.bounds.left||event.clientX>current.bounds.right||event.clientY>current.bounds.bottom+32;}
 function interruptStartup(){
  if(!take||voice.getState()!=='starting')return false;
  suppressPhysicalClick();const current=take;current.startupInterrupted=true;current.pressed=false;current.releaseRequested=false;current.finalText='';current.interimText='';
  if(current.pointerId!==undefined)try{hold.releasePointerCapture(current.pointerId);}catch{}
  $('chat-voice-state').textContent='请先完成系统权限选择';message('若出现系统权限窗口，请先完成选择，再重新按住说话。本次不会发送。');renderControls();changed();return true;
 }
 function release(event){
  const current=take;if(!current||!current.pressed)return;
  if(current.source==='pointer'&&event?.pointerId!==current.pointerId)return;
  if(current.source==='pointer'&&event)current.cancelArmed=isCancelPosition(event);
  if(current.cancelArmed){cancel();return;}
  if(interruptStartup())return;
  current.pressed=false;current.releaseRequested=true;renderControls();changed();
  if(current.ended)finish();else voice.stop();
  if(current.pointerId!==undefined)try{hold.releasePointerCapture(current.pointerId);}catch{}
 }
 toggle.addEventListener('click',()=>{if(take)cancel();if(!voice.supported){setMode(false);fallback.textContent=ERRORS.unsupported;fallback.hidden=false;message(ERRORS.unsupported,'error');renderControls();changed();return;}setMode(!voiceMode);if(voiceMode){keyboardGuide=false;fallback.hidden=true;renderControls();input.blur();if(!acknowledged)acknowledged=readAcknowledgement();if(!acknowledged)dialog.showModal();}else input.focus({preventScroll:true});});
 hold.addEventListener('pointerdown',event=>{if(event.button!==0||event.isPrimary===false)return;event.preventDefault();suppressPhysicalClick();clearControlSelection();if(begin('pointer',event))try{hold.setPointerCapture(event.pointerId);}catch{if(!interruptStartup())cancel();}});
  hold.addEventListener('pointermove',event=>{if(take?.source!=='pointer'||take.pointerId!==event.pointerId||!take.pressed)return;if(event.cancelable)event.preventDefault();take.cancelArmed=isCancelPosition(event);$('chat-voice-state').textContent=take.cancelArmed?'松开取消这条语音':take.ended?'识别已结束，松手后核对':take.finalText||take.interimText?'已收到文字，松开发送':diagnosis?.speech?'检测到语音，等待文字…':'等待识别文字…';renderControls();});
 hold.addEventListener('pointerup',event=>{if(event.cancelable)event.preventDefault();suppressPhysicalClick();release(event);});
 hold.addEventListener('pointercancel',()=>{suppressPhysicalClick();if(take?.source==='pointer'&&take.pressed&&!interruptStartup())cancel();});
 hold.addEventListener('lostpointercapture',event=>{if(take?.pressed&&take.pointerId===event.pointerId){suppressPhysicalClick();if(!interruptStartup())cancel();}});
 // Safari's long-press selection/callout is separate from Pointer Events.
 // Suppress only the voice controls; the message input and transcript remain
 // editable/selectable, and touch handlers never start a second recognizer.
 const preventControlDefault=event=>{if(event.cancelable)event.preventDefault();};
 for(const control of[hold,toggle])for(const type of['contextmenu','selectstart','dragstart'])control.addEventListener(type,preventControlDefault);
 for(const type of['touchstart','touchmove'])hold.addEventListener(type,event=>{preventControlDefault(event);clearControlSelection();},{passive:false});
 hold.addEventListener('touchend',event=>{preventControlDefault(event);suppressPhysicalClick();},{passive:false});
 hold.addEventListener('touchcancel',event=>{preventControlDefault(event);suppressPhysicalClick();if(take?.source==='pointer'&&take.pressed&&!interruptStartup())cancel();},{passive:false});
 hold.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();if(!event.repeat){suppressClickUntil=Date.now()+1000;begin('keyboard');}}else if(event.key==='Escape'){event.preventDefault();cancel();}});
 document.addEventListener('keyup',event=>{if(take?.source==='keyboard'&&[' ','Enter'].includes(event.key)){event.preventDefault();suppressClickUntil=Date.now()+1000;release();}});
 hold.addEventListener('click',event=>{event.preventDefault();if(event.detail!==0||Date.now()<suppressClickUntil)return;if(take?.source==='assistive')release();else begin('assistive');});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&take){event.preventDefault();cancel();}});
 $('chat-voice-start').addEventListener('click',()=>{acknowledged=true;const remembered=rememberAcknowledgement();dialog.close();message(remembered?'已记住使用说明。请按住“按住说话”，说完松手。':'本次已确认。请按住“按住说话”，说完松手。');hold.focus({preventScroll:true});});$('chat-voice-dismiss').addEventListener('click',()=>{dialog.close();setMode(false);});
 dialog.addEventListener('cancel',()=>{if(!acknowledged)setMode(false);});
 $('chat-voice-cancel').addEventListener('click',()=>{if(take||pendingText)cancel();else panel.hidden=true;});$('chat-voice-apply').addEventListener('click',()=>{if(pendingText&&!take){const text=pendingText;if(fill(text)){message('文字已填入，请检查后点发送。');setMode(false);}}});
 $('chat-voice-dictate').addEventListener('click',()=>{if(blocked)return;const candidate=take?.cancelArmed||take?.startupInterrupted?'':(take?.reviewText||[take?.finalText,take?.interimText].filter(Boolean).join(' ')||pendingText).trim();cancel({silent:true});if(candidate)fill(candidate);setMode(false);keyboardGuide=true;fallback.hidden=false;fallback.textContent='请点 iPhone 键盘上的麦克风说话，文字会填进输入框；核对后点“发送”。找不到麦克风时，到“设置 → 通用 → 键盘”开启“启用听写”。';message('已切到键盘听写，请再点系统键盘上的麦克风。');renderControls();input.focus({preventScroll:true});try{input.setSelectionRange(input.value.length,input.value.length);}catch{}});
 input.addEventListener('input',()=>{if(keyboardGuide&&input.value.trim()){keyboardGuide=false;fallback.hidden=true;renderControls();}});
 $('chat-voice-diagnostics').addEventListener('toggle',positionDiagnosis);window.addEventListener('resize',positionDiagnosis);window.visualViewport?.addEventListener('resize',positionDiagnosis);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel({silent:true});});window.addEventListener('pagehide',()=>cancel({silent:true}));window.addEventListener('blur',()=>{if(take&&!interruptStartup())cancel({silent:true});});
 setMode(false);
 return{isActive:active,hasUnsavedWork:()=>active()||Boolean(pendingText),cancel,setBlocked(value){blocked=Boolean(value);if(blocked&&take)cancel({silent:true});renderControls();},closeDialog(){if(dialog.open){dialog.close();if(!acknowledged)setMode(false);}},supported:voice.supported};
}
