import{createVoiceInput}from'./voice-input.js';
import{icon}from'./icons.js';

const ERRORS={unsupported:'当前浏览器不能直接听写，请使用键盘麦克风，或在 iPhone 的 Safari 中再试。','not-allowed':'没有获得麦克风或语音识别权限。原输入保留，请在浏览器设置中检查权限，或使用键盘听写。','service-not-allowed':'当前浏览器的语音识别服务不可用。iPhone 可检查 Siri 和语音权限，也可以用键盘听写。',network:'语音识别连接失败。浏览器的识别服务可能需要网络，请检查网络或使用键盘听写。','no-speech':'没有识别到清楚的语音。可以重新点“语音”，也可以直接打字。','audio-capture':'麦克风暂时不可用，请检查设备权限或是否正被其他应用占用。','language-not-supported':'当前识别服务暂不支持中文，请用键盘听写或直接打字。',aborted:'本次听写已停止，原输入保留。','start-failed':'这次无法启动语音识别，请使用键盘听写，或在 Safari 中重试。',timeout:'语音服务没有及时返回，已停止本次听写。原输入保留，请重试或使用键盘听写。'};

/** The browser owns speech processing. This view holds text only, never a
 * recording, provider credential or automatic AI/network submission. */
export function createVoiceUI({host,input,onChange,onStatus}){
 const $=id=>host.querySelector('#'+id);
 const button=document.createElement('button');button.id='chat-voice';button.type='button';button.className='chat-voice-button';button.setAttribute('aria-pressed','false');button.setAttribute('aria-controls','chat-voice-panel');button.innerHTML=icon('mic')+'<span>语音</span>';
 $('chat-send').before(button);
 const panel=document.createElement('div');panel.id='chat-voice-panel';panel.className='voice-panel';panel.hidden=true;
 panel.innerHTML='<div class="voice-state-row"><strong id="chat-voice-state" role="status" aria-live="polite">准备听写</strong><span id="chat-voice-time" aria-hidden="true">0:00 / 1:00</span></div><p id="chat-voice-live"></p><div class="voice-panel-actions"><button id="chat-voice-stop" type="button" class="button secondary">停止并转文字</button><button id="chat-voice-apply" type="button" class="button secondary" hidden>填入文字</button><button id="chat-voice-cancel" type="button" class="text-button">取消本次</button></div>';
 input.before(panel);
 const fallback=document.createElement('p');fallback.id='chat-voice-fallback';fallback.hidden=true;fallback.setAttribute('role','status');input.after(fallback);
 const dialog=document.createElement('dialog');dialog.id='chat-voice-dialog';dialog.className='sheet-dialog small-dialog';dialog.setAttribute('aria-labelledby','chat-voice-dialog-title');
 dialog.innerHTML='<h2 id="chat-voice-dialog-title">用语音填入文字</h2><p>你说的话由当前浏览器或系统的语音识别服务处理，可能需要联网。轻记不保存录音，也不把录音发送给你配置的 AI 接口。</p><p>文字会先填入输入框。你可以修改，再点“发送给 AI”。本次听写最长 60 秒。</p><div class="dialog-actions"><button id="chat-voice-dismiss" type="button" class="button secondary">先不用</button><button id="chat-voice-start" type="button" class="button primary">开始听写</button></div>';
 host.append(dialog);
 let acknowledged=false,blocked=false,sessionOpen=false,finalText='',interimText='',pendingText='',errorCode='',timer=null,startupTimer=null,startedAt=0,voice=null;
 const change=()=>{try{onChange?.();}catch{}};
 function message(text,kind=''){onStatus?.(text,kind);}
 function clearTimers(){clearInterval(timer);clearTimeout(startupTimer);timer=null;startupTimer=null;}
 function renderControls(){
  const active=Boolean(voice?.isActive()),state=voice?.getState()||'idle';
  button.disabled=blocked||state==='stopping';button.setAttribute('aria-pressed',String(active));button.querySelector('span').textContent=state==='starting'?'取消':active?'听写中':'语音';
  $('chat-voice-stop').hidden=!active;$('chat-voice-stop').disabled=state!=='listening';$('chat-voice-apply').hidden=active||!pendingText;$('chat-voice-cancel').textContent=active?'取消本次':pendingText?'放弃这段':'关闭';
 }
 function renderTranscript(){
  $('chat-voice-live').replaceChildren();
  if(finalText){const span=document.createElement('span');span.textContent=finalText;$('chat-voice-live').append(span);}
  if(interimText){const span=document.createElement('span');span.className='voice-interim';span.textContent=(finalText?' ':'')+interimText;$('chat-voice-live').append(span);}
  if(!finalText&&!interimText)$('chat-voice-live').textContent='例如：今天午饭二十八元，地铁六元。';
 }
 function fillText(text){
  const before=input.value,separator=before&&!/[\s，,；;。.!！?？]$/.test(before)?'，':'';
  const combined=before+separator+text,limit=input.maxLength>0?input.maxLength:2000;
  if(combined.length>limit){pendingText=text;panel.hidden=false;$('chat-voice-state').textContent='文字较多，尚未填入';message('输入框空间不够，未截断或覆盖原内容。请先缩短输入，再点“填入文字”。','error');renderTranscript();renderControls();change();return false;}
  input.value=combined;pendingText='';input.dispatchEvent(new Event('input',{bubbles:true}));panel.hidden=true;fallback.hidden=true;message('已转成文字，请检查或修改，再点“发送给 AI”。');renderControls();change();return true;
 }
 function endSession(reason){
  if(!sessionOpen){renderControls();change();return;}sessionOpen=false;clearTimers();
  if(reason==='ended'&&!errorCode&&finalText.trim()){fillText(finalText.trim());return;}
  if(errorCode&&finalText.trim()&&reason!=='cancelled'){
   pendingText=finalText.trim();interimText='';panel.hidden=false;$('chat-voice-state').textContent='识别中断，这段尚未填入';renderTranscript();
  }else{pendingText='';panel.hidden=true;}
  renderControls();change();
 }
 function handleState({state,reason}){
  if(state==='starting'){
   sessionOpen=true;panel.hidden=false;$('chat-voice-state').textContent='正在启动语音识别…';$('chat-voice-time').textContent='0:00 / 1:00';
  }else if(state==='listening'){
   clearTimeout(startupTimer);startupTimer=null;startedAt=Date.now();$('chat-voice-state').textContent='正在听，请说这笔账';
   clearInterval(timer);timer=setInterval(()=>{const seconds=Math.min(60,Math.floor((Date.now()-startedAt)/1000));$('chat-voice-time').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} / 1:00`;},1000);
  }else if(state==='stopping'){$('chat-voice-state').textContent='正在整理最后的文字…';clearInterval(timer);timer=null;}
  else if(state==='idle'){endSession(reason);return;}
  renderControls();change();
 }
 voice=createVoiceInput({onState:handleState,onTranscript:result=>{finalText=result.finalText;interimText=result.interimText;renderTranscript();},onError:({code})=>{errorCode=code;fallback.textContent=ERRORS[code]||ERRORS['start-failed'];fallback.hidden=false;message(fallback.textContent,'error');},language:'zh-CN',maxDurationMs:60000});
 function begin(){
  if(blocked)return;
  if(pendingText){panel.hidden=false;message('上一段文字还没有填入，请先填入或放弃。');return;}
  if(!voice.supported){fallback.textContent=ERRORS.unsupported;fallback.hidden=false;message(ERRORS.unsupported,'error');return;}
  finalText='';interimText='';errorCode='';pendingText='';sessionOpen=true;fallback.hidden=true;message('');renderTranscript();
  const started=voice.start();renderControls();change();
  if(!started){sessionOpen=false;panel.hidden=true;renderControls();change();return;}
  if(voice.getState()==='starting')startupTimer=setTimeout(()=>{if(voice.getState()!=='starting')return;cancel({silent:true});fallback.textContent=ERRORS.timeout;fallback.hidden=false;message(ERRORS.timeout,'error');},15000);
  panel.scrollIntoView({block:'nearest',behavior:'instant'});
 }
 function cancel({silent=false}={}){
  const hadWork=Boolean(voice.isActive()||pendingText);sessionOpen=false;pendingText='';finalText='';interimText='';errorCode='';clearTimers();voice.cancel();panel.hidden=true;renderControls();change();
  if(!silent&&hadWork)message('已取消本次听写，原输入保留。');
 }
 button.addEventListener('click',()=>{
  if(voice.isActive()){if(voice.getState()==='starting')cancel();else voice.stop();return;}
  if(pendingText){panel.hidden=false;message('这段识别文字还未填入，请先处理。');return;}
  if(!voice.supported){begin();return;}
  if(acknowledged)begin();else dialog.showModal();
 });
 $('chat-voice-start').addEventListener('click',()=>{acknowledged=true;dialog.close();begin();});
 $('chat-voice-dismiss').addEventListener('click',()=>dialog.close());
 $('chat-voice-stop').addEventListener('click',()=>voice.stop());
 $('chat-voice-cancel').addEventListener('click',()=>{if(voice.isActive()||pendingText)cancel();else panel.hidden=true;});
 $('chat-voice-apply').addEventListener('click',()=>{if(pendingText&&!voice.isActive())fillText(pendingText);});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel({silent:true});});
 window.addEventListener('pagehide',()=>{acknowledged=false;cancel({silent:true});});
 renderControls();
 return{isActive:()=>voice.isActive(),hasUnsavedWork:()=>Boolean(voice.isActive()||pendingText),cancel,setBlocked(value){blocked=Boolean(value);renderControls();},closeDialog(){if(dialog.open)dialog.close();},supported:voice.supported};
}
