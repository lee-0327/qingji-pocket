const ERROR_CODES=new Set(['unsupported','not-allowed','service-not-allowed','network','no-speech','audio-capture','language-not-supported','aborted','start-failed','timeout']);
const MAX_TRANSCRIPT_CHARS=12000;
const call=(callback,value)=>{if(typeof callback==='function')try{callback(value);}catch{ /* UI callbacks cannot keep a microphone session alive. */ }};
const text=value=>typeof value==='string'?value.replace(/[\u0000-\u001F\u007F\s]+/g,' ').trim().slice(0,MAX_TRANSCRIPT_CHARS):'';
const duration=(value,fallback,min,max)=>Number.isFinite(value)?Math.min(max,Math.max(min,Math.round(value))):fallback;

/** Browser/system recognition only. The caller obtains consent and invokes
 * start() directly from a user gesture. Audio routing is the browser's policy;
 * this module does not record files, access credentials or contact an AI API. */
export function createVoiceInput({onState,onTranscript,onError,language='zh-CN',maxDurationMs=60000,stopTimeoutMs=5000}={}){
 const Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
 const supported=typeof Recognition==='function'&&globalThis.isSecureContext!==false;
 const limit=duration(maxDurationMs,60000,1000,60000),stopLimit=duration(stopTimeoutMs,5000,250,5000);
 let session=null,state='idle',generation=0,disposed=false;

 function emitState(value,reason){state=value;call(onState,{state:value,...(reason?{reason}:{})});}
 function emitError(code){call(onError,{code:ERROR_CODES.has(code)?code:'start-failed'});}
 function current(value){return !disposed&&session===value&&value.id===generation;}
 function publish(value){
  const snapshot=JSON.stringify([value.finalText,value.interimText]);
  if(snapshot===value.published)return;
  value.published=snapshot;call(onTranscript,{finalText:value.finalText,interimText:value.interimText});
 }
 function detach(value){for(const event of['onstart','onresult','onerror','onend','onnomatch'])value.recognition[event]=null;}
 function finish(value,{reason='ended',code='',discard=false,abort=false}={}){
  if(!current(value))return;
  clearTimeout(value.limitTimer);clearTimeout(value.stopTimer);detach(value);session=null;const finishedGeneration=++generation;state='idle';
  if(discard)value.finalText='';value.interimText='';
  if(abort)try{value.recognition.abort();}catch{ /* The browser may already have disconnected. */ }
  publish(value);
  if(disposed||generation!==finishedGeneration||session)return;
  if(code)emitError(code);else if(!value.finalText&&reason==='ended')emitError('no-speech');
  if(disposed||generation!==finishedGeneration||session)return;
  emitState('idle',reason);
 }
 function stop(reason='requested'){
  const value=session;if(!value||disposed||state==='stopping')return false;
  clearTimeout(value.limitTimer);emitState('stopping',reason);if(!current(value))return false;
  value.stopTimer=setTimeout(()=>finish(value,{reason:'timeout',code:'timeout',abort:true}),stopLimit);
  try{value.recognition.stop();return true;}catch{finish(value,{reason:'error',code:'start-failed',abort:true});return false;}
 }
 function start(){
  if(disposed||session)return false;
  if(!supported){emitError('unsupported');return false;}
  let recognition;
  try{recognition=new Recognition();}catch{emitError('start-failed');return false;}
  const value={id:++generation,recognition,finalText:'',interimText:'',published:null,limitTimer:null,stopTimer:null};
  session=value;emitState('starting');if(!current(value))return false;publish(value);if(!current(value))return false;
  recognition.onstart=()=>{if(current(value)&&state!=='stopping')emitState('listening');};
  recognition.onresult=event=>{
   if(!current(value))return;
   const results=event?.results;
   if(!results||!Number.isInteger(results.length)||results.length<0)return;
   const finals=[],interims=[];
   // results is the entire current session, not only resultIndex's delta.
   // Rebuilding handles replaced/removed interim entries without duplication.
   for(let index=0;index<Math.min(results.length,256);index++){
    const result=results[index],phrase=text(result?.[0]?.transcript);if(!phrase)continue;
    (result.isFinal===true?finals:interims).push(phrase);
   }
   value.finalText=finals.join(' ').slice(0,MAX_TRANSCRIPT_CHARS);value.interimText=interims.join(' ').slice(0,MAX_TRANSCRIPT_CHARS);publish(value);
  };
  recognition.onerror=event=>{
   if(!current(value))return;
   const code=ERROR_CODES.has(event?.error)?event.error:'start-failed';
   finish(value,{reason:code==='aborted'?'cancelled':'error',code,discard:code==='aborted',abort:true});
  };
  recognition.onend=()=>finish(value);
  recognition.onnomatch=()=>{ /* Wait for end, which emits no-speech once if needed. */ };
  try{
   recognition.lang=typeof language==='string'&&language.trim()?language.trim():'zh-CN';
   recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=1;
   value.limitTimer=setTimeout(()=>{if(current(value))stop('limit');},limit);
   // Synchronous: do not await permissions/network before this user gesture.
   recognition.start();return true;
  }catch(error){const code=['NotAllowedError','SecurityError'].includes(error?.name)?'not-allowed':'start-failed';finish(value,{reason:'error',code,abort:true});return false;}
 }
 function cancel(){const value=session;if(!value||disposed)return false;finish(value,{reason:'cancelled',discard:true,abort:true});return true;}
 function dispose(){if(disposed)return;cancel();disposed=true;generation++;}
 return Object.freeze({supported,start,stop:()=>stop(),cancel,dispose,isActive:()=>Boolean(session),getState:()=>state});
}
