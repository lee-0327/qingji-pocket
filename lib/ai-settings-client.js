import{createAIProviderError}from'./ai-providers.js';
function settingsError(code,type){const error=createAIProviderError(code);if(type==='reply'){const notes={auth:'服务未接受此密钥，或没有调用所选模型的权限。请检查密钥和模型。',response:'接口未按测试要求返回文字结果。请检查模型是否支持 Chat Completions 与 JSON 回复；没有自动换模型。',network:'未能连接回复测试接口，请检查网络与跨域设置。没有自动重试。',timeout:'等待 AI 测试回复超时，已停止等待。服务商仍可能处理并计费。',rate:'服务商限制了调用频率或账号额度，请到服务商处检查。'};error.message=notes[error.code]||error.message;}return error;}
// One short-lived worker per explicit operation. It has no ledger or cookies.
export function requestAISettings(type,{config,apiKey='',signal}={}){
 if(!['models','probe','reply'].includes(type))return Promise.reject(createAIProviderError('config'));
 if(signal?.aborted)return Promise.reject(createAIProviderError('cancelled'));
 return new Promise((resolve,reject)=>{
  let worker,timer,settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();error?reject(error):resolve(result);};
  const abort=()=>finish(createAIProviderError('cancelled'));
  try{worker=new Worker(new URL('./ai-settings-worker.js',import.meta.url),{type:'module',name:'qingji-settings-once'});}catch{finish(createAIProviderError('network'));return;}
  worker.onmessage=event=>{if(event.data?.type==='error'){finish(settingsError(event.data.code,type));return;}if(event.data?.type!=='result')return;try{if(apiKey&&JSON.stringify(event.data.result).includes(apiKey))throw new Error();finish(null,event.data.result);}catch{finish(settingsError('response',type));}};
  worker.onerror=event=>{event.preventDefault();finish(createAIProviderError('network'));};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
  timer=setTimeout(()=>finish(settingsError('timeout',type)),type==='reply'?45000:18000);
  try{worker.postMessage({type,config,apiKey});}catch{finish(createAIProviderError('response'));}
 });
}
