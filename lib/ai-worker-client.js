const MESSAGES={VISION:'所选模型只支持文字，不能直接识别图片。请自行选择支持图片的模型，或用首页截图记账。本次图片尚未发送。',CONFIG:'接口配置已变化或尚未完成，请检查配置后重新确认发送。',AUTH:'请填写本次使用的有效密钥。',RATE_LIMIT:'服务商提示额度、余额或请求频率不足，请查看自己的服务账户。',NETWORK:'未能连接接口，请检查网络及服务商的跨域访问设置。没有自动重试。',TIMEOUT:'等待超过了时限，没有自动重试。服务商仍可能已处理并计费。',ABORTED:'已停止等待。已经发出的请求仍可能被服务商处理和计费。',RESPONSE:'接口返回的账单格式无法安全使用，请修改输入或手动记账。',IMAGE:'本次图片尚未准备好，或接口未启用图片方式。'};

export function chatRequestError(code='RESPONSE'){
 const safe=Object.hasOwn(MESSAGES,code)?code:'RESPONSE';
 const error=new Error(MESSAGES[safe]);error.code=safe;error.name=safe==='ABORTED'?'AbortError':'AIRequestError';return error;
}

// The private session owner supplies a key for this one request. This bridge
// never stores it, reads a ledger, fetches a remote script or changes provider.
export function requestConversationInWorker({config,apiKey,payload,imageDataUrl,signal}){
 if(signal?.aborted)return Promise.reject(chatRequestError('ABORTED'));
 return new Promise((resolve,reject)=>{
  let worker,timer,settled=false;
  const finish=(error,result)=>{
   if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();
   if(error)reject(error);else resolve(result);
  };
  const abort=()=>finish(chatRequestError('ABORTED'));
  try{worker=new Worker(new URL('../ai-worker.js',import.meta.url),{type:'module',name:'qingji-chat-once'});}catch{finish(chatRequestError('NETWORK'));return;}
  worker.onmessage=event=>{
   if(event.data?.type==='error'){finish(chatRequestError(event.data.code));return;}
   if(event.data?.type!=='result')return;
   try{if(JSON.stringify(event.data.result).includes(apiKey)){finish(chatRequestError('RESPONSE'));return;}}catch{finish(chatRequestError('RESPONSE'));return;}
   finish(null,event.data.result);
  };
  worker.onerror=event=>{event.preventDefault();finish(chatRequestError('NETWORK'));};
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){abort();return;}
  timer=setTimeout(()=>finish(chatRequestError('TIMEOUT')),47000);
  try{worker.postMessage({type:'conversation',config,apiKey,payload,...(imageDataUrl?{imageDataUrl}:{})});}catch{finish(chatRequestError('RESPONSE'));}
 });
}
