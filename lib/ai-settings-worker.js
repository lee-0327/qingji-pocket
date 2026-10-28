import{listAIModels,probeAIConnection}from'./ai-providers.js';
import{requestStructuredAIJSON,parseStructuredAIReply}from'./ai-client.js';
let used=false;
self.onmessage=async event=>{
 if(used||!['models','probe','reply'].includes(event.data?.type))return;used=true;
 const{type,config,apiKey=''}=event.data;
 try{
  let result;
  if(type==='models')result=await listAIModels({baseUrl:config?.baseUrl,apiKey});
  else if(type==='probe')result=await probeAIConnection({...config,apiKey});
  else{
   await requestStructuredAIJSON(config,{apiKey,payload:'连接测试：请回复 JSON {"ok":true}。',systemPrompt:'这是用户主动确认的接口连接测试，不涉及账单。只输出 JSON 对象 {"ok":true}。',maxTokens:64,validateResult:envelope=>{const value=parseStructuredAIReply(envelope);if(value.ok!==true||Object.keys(value).length!==1){const error=new Error();error.code='response';throw error;}return true;}});
   result={scope:'inference',inferenceTested:true,visionTested:false};
  }
  self.postMessage({type:'result',result});
 }catch(error){self.postMessage({type:'error',code:typeof error?.code==='string'?error.code:'response'});}
 finally{self.close();}
};
