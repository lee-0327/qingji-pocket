import{createVoiceInput}from'./voice-input.js';
import{icon}from'./icons.js';

const ERRORS={unsupported:'当前浏览器不支持直接语音识别，请切回文字，使用 iPhone 键盘的麦克风听写。','not-allowed':'未获得麦克风或语音识别权限。请检查浏览器权限，或使用键盘听写。','service-not-allowed':'系统语音识别暂不可用。可检查 Siri 和语音权限，或使用键盘听写。',network:'语音识别连接失败。已确认的文字会保留，请检查后手动发送。','no-speech':'没有听到清楚的内容，请重新按住说话。','audio-capture':'麦克风暂不可用，请检查权限或其他应用是否正在使用。','language-not-supported':'当前语音服务不支持中文，请使用键盘听写或打字。',aborted:'本次语音已取消，原输入保留。','start-failed':'无法启动语音识别，请使用键盘听写，或在 Safari 中重试。',timeout:'语音识别等待超时，已停止。已确认的文字会保留，请检查后发送。'};
const keyboardIcon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h1m4 0h1m4 0h1M6 12h1m4 0h1m4 0h1M7 16h10"/></svg>';

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
 const dialog=document.createElement('dialog');dialog.id='chat-voice-dialog';dialog.className='sheet-dialog small-dialog';dialog.setAttribute('aria-labelledby','chat-voice-dialog-title');
 dialog.innerHTML='<h2 id="chat-voice-dialog-title">按住说话，松开发送</h2><p>你说的话由浏览器或系统的语音服务识别，可能需要联网。轻记不保存录音，也不把录音发给你配置的 AI。</p><p>正常松手后，会把识别文字提交给当前选定的 AI 接口，可能产生调用费用。向上滑动可以取消。最长 60 秒；识别失败时保留已确认文字，由你检查后发送。</p><div class="dialog-actions"><button id="chat-voice-dismiss" type="button" class="button secondary">先不用</button><button id="chat-voice-start" type="button" class="button primary">知道了，去说话</button></div>';
 host.append(dialog);
 let acknowledged=false,blocked=false,voiceMode=false,take=null,pendingText='',voice=null,timer=null,startupTimer=null,sequence=0,suppressClickUntil=0;
 const changed=()=>{try{onChange?.();}catch{}};
 const message=(text,kind='')=>onStatus?.(text,kind);
 const active=()=>Boolean(take);
 function clearTimers(){clearInterval(timer);clearTimeout(startupTimer);timer=null;startupTimer=null;}
 function setMode(value){voiceMode=Boolean(value);host.classList.toggle('chat-voice-mode',voiceMode);input.hidden=voiceMode;hold.hidden=!voiceMode;renderControls();}
 function renderControls(){
  toggle.disabled=blocked||active();toggle.setAttribute('aria-pressed',String(voiceMode));toggle.setAttribute('aria-label',voiceMode?'切换到文字输入':'切换到按住说话');toggle.innerHTML=(voiceMode?keyboardIcon:icon('mic'))+'<span class="voice-toggle-label">'+(voiceMode?'键盘':'语音')+'</span>';
  hold.disabled=blocked||Boolean(take&&!take.pressed);hold.textContent=take?(take.cancelArmed?'松开取消':take.ended?'松开发送':voice?.getState()==='starting'?'正在开启…':take.pressed?'松开发送':'正在识别…'):'按住说话';
  hold.setAttribute('aria-label',take?.source==='assistive'?'轻点结束并发送':'按住说话，松开发送，向上滑动取消；也可按住空格或回车');hold.classList.toggle('is-holding',Boolean(take?.pressed));hold.classList.toggle('is-cancelling',Boolean(take?.cancelArmed));panel.classList.toggle('is-cancelling',Boolean(take?.cancelArmed));
  $('chat-voice-apply').hidden=active()||!pendingText;$('chat-voice-cancel').textContent=active()?'取消本次':pendingText?'放弃这段':'关闭';
 }
 function transcript(){
  const finalText=take?.finalText||pendingText,interim=take?.interimText||'';$('chat-voice-live').replaceChildren();
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
  take=null;clearTimers();const finalText=current.finalText.trim();panel.hidden=true;
  if(current.cancelled){renderControls();changed();return;}
  if(!finalText){setMode(false);fallback.hidden=false;const tooShort=Date.now()-current.pressAt<500&&(!current.errorCode||current.errorCode==='no-speech');fallback.textContent=tooShort?'说话时间太短，请按住说完后再松手。':ERRORS[current.errorCode]||ERRORS['no-speech'];message(fallback.textContent,'error');renderControls();changed();return;}
  if(!fill(finalText))return;
  if(current.errorCode||current.endReason!=='ended'||!current.releaseRequested){setMode(false);fallback.hidden=false;fallback.textContent=ERRORS[current.errorCode]||'语音已转成文字，尚未发送。请检查后点发送。';message(fallback.textContent,'error');renderControls();changed();return;}
  fallback.hidden=true;renderControls();changed();
  const seconds=Math.max(1,Math.min(60,Math.ceil(((current.endedAt||Date.now())-(current.listenAt||current.pressAt))/1000)));
  message('语音已转成文字，正在提交这条消息…');
  const submitted=input.value,sendFailed=()=>{if(sequence!==current.id||take||input.value!==submitted)return;setMode(false);message('语音文字已保留，请检查后重新发送。','error');};
  try{Promise.resolve(onSend?.({text:submitted,durationSeconds:seconds})).catch(sendFailed);}catch{sendFailed();}
 }
 voice=createVoiceInput({language:'zh-CN',maxDurationMs:60000,onState:({state,reason})=>{
  if(!take)return;
  if(state==='starting'){$('chat-voice-state').textContent='正在开启语音识别…';panel.hidden=false;}
  else if(state==='listening'){clearTimeout(startupTimer);startupTimer=null;take.listenAt=Date.now();$('chat-voice-state').textContent='正在听，松开发送';}
  else if(state==='stopping'){$('chat-voice-state').textContent=reason==='limit'?'已到 60 秒，松开发送':'正在整理最后的文字…';}
  else if(state==='idle'){take.ended=true;take.endedAt=Date.now();take.endReason=reason;clearTimers();if(take.pressed){$('chat-voice-state').textContent=take.errorCode?'识别中断，松开后检查文字':'已识别，松开发送';renderControls();changed();return;}finish();return;}
  renderControls();changed();
 },onTranscript:result=>{if(!take)return;take.finalText=result.finalText;take.interimText=result.interimText;transcript();},onError:({code})=>{if(!take)return;take.errorCode=code;fallback.textContent=ERRORS[code]||ERRORS['start-failed'];fallback.hidden=false;}});
 function cancel({silent=false}={}){
  const hadWork=active()||Boolean(pendingText),previous=take;sequence++;take=null;pendingText='';clearTimers();voice.cancel();panel.hidden=true;
  if(previous?.pointerId!==undefined)try{hold.releasePointerCapture(previous.pointerId);}catch{}
  renderControls();changed();if(!silent&&hadWork)message('已取消本次语音，原输入保留。');
 }
 function begin(source,event){
  if(blocked){message('正在处理上一条消息，请稍后再说。');return false;}
  if(take)return false;
  if(pendingText){message('上一段语音还未填入，请先处理或放弃。');return false;}
  if(!voice.supported){setMode(false);fallback.textContent=ERRORS.unsupported;fallback.hidden=false;message(ERRORS.unsupported,'error');return false;}
  if(!acknowledged){dialog.showModal();return false;}
  const current={id:++sequence,source,pointerId:source==='pointer'?event.pointerId:undefined,startX:event?.clientX,startY:event?.clientY,bounds:source==='pointer'?hold.getBoundingClientRect():null,pressAt:Date.now(),listenAt:0,finalText:'',interimText:'',pressed:true,cancelArmed:false,ended:false,endReason:'',errorCode:'',releaseRequested:false};take=current;fallback.hidden=true;message('');$('chat-voice-time').textContent='0:00 / 1:00';transcript();
  const started=voice.start();
  if(!started){if(take===current){current.pressed=false;current.ended=true;current.errorCode=current.errorCode||'start-failed';finish();}return false;}
  timer=setInterval(()=>{if(!take)return;const seconds=Math.min(60,Math.floor((Date.now()-(take.listenAt||take.pressAt))/1000));$('chat-voice-time').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} / 1:00`;},1000);
  if(voice.getState()==='starting')startupTimer=setTimeout(()=>{if(!take||take.id!==current.id||voice.getState()!=='starting')return;take.errorCode='timeout';take.pressed=false;take.releaseRequested=false;voice.cancel();},15000);
  renderControls();changed();return true;
 }
 function isCancelPosition(event){const current=take;if(!current?.bounds)return false;return current.startY-event.clientY>=64||event.clientX<current.bounds.left||event.clientX>current.bounds.right||event.clientY>current.bounds.bottom+32;}
 function release(event){
  const current=take;if(!current||!current.pressed)return;
  if(current.source==='pointer'&&event?.pointerId!==current.pointerId)return;
  if(current.source==='pointer'&&event)current.cancelArmed=isCancelPosition(event);
  if(current.cancelArmed){cancel();return;}
  current.pressed=false;current.releaseRequested=true;renderControls();changed();
  if(current.ended)finish();else voice.stop();
  if(current.pointerId!==undefined)try{hold.releasePointerCapture(current.pointerId);}catch{}
 }
 toggle.addEventListener('click',()=>{if(take)cancel();if(!voice.supported){setMode(false);fallback.textContent=ERRORS.unsupported;fallback.hidden=false;message(ERRORS.unsupported,'error');return;}setMode(!voiceMode);if(voiceMode)input.blur();else input.focus({preventScroll:true});});
 hold.addEventListener('pointerdown',event=>{if(event.button!==0||event.isPrimary===false)return;event.preventDefault();if(begin('pointer',event))try{hold.setPointerCapture(event.pointerId);}catch{cancel();}});
 hold.addEventListener('pointermove',event=>{if(take?.source!=='pointer'||take.pointerId!==event.pointerId||!take.pressed)return;take.cancelArmed=isCancelPosition(event);$('chat-voice-state').textContent=take.cancelArmed?'松开取消这条语音':take.ended?'已识别，松开发送':'正在听，松开发送';renderControls();});
 hold.addEventListener('pointerup',release);hold.addEventListener('pointercancel',()=>cancel());hold.addEventListener('lostpointercapture',event=>{if(take?.pressed&&take.pointerId===event.pointerId)cancel();});hold.addEventListener('contextmenu',event=>event.preventDefault());
 hold.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();if(!event.repeat){suppressClickUntil=Date.now()+1000;begin('keyboard');}}else if(event.key==='Escape'){event.preventDefault();cancel();}});
 document.addEventListener('keyup',event=>{if(take?.source==='keyboard'&&[' ','Enter'].includes(event.key)){event.preventDefault();suppressClickUntil=Date.now()+1000;release();}});
 hold.addEventListener('click',event=>{event.preventDefault();if(event.detail!==0||Date.now()<suppressClickUntil)return;if(take?.source==='assistive')release();else begin('assistive');});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&take){event.preventDefault();cancel();}});
 $('chat-voice-start').addEventListener('click',()=>{acknowledged=true;dialog.close();message('已准备。请重新按住“按住说话”，说完松手。');hold.focus({preventScroll:true});});$('chat-voice-dismiss').addEventListener('click',()=>dialog.close());
 $('chat-voice-cancel').addEventListener('click',()=>{if(take||pendingText)cancel();else panel.hidden=true;});$('chat-voice-apply').addEventListener('click',()=>{if(pendingText&&!take){const text=pendingText;if(fill(text)){message('文字已填入，请检查后点发送。');setMode(false);}}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel({silent:true});});window.addEventListener('pagehide',()=>{acknowledged=false;cancel({silent:true});});window.addEventListener('blur',()=>{if(take)cancel({silent:true});});
 setMode(false);
 return{isActive:active,hasUnsavedWork:()=>active()||Boolean(pendingText),cancel,setBlocked(value){blocked=Boolean(value);if(blocked&&take)cancel({silent:true});renderControls();},closeDialog(){if(dialog.open)dialog.close();},supported:voice.supported};
}
