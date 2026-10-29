import{requestAIExtraction}from'./lib/ai-client.js';
import{requestAIConversation}from'./lib/ai-chat-client.js';

let used=false;
self.onmessage=async event=>{
 if(used||!['extract','conversation'].includes(event.data?.type))return;
 used=true;
 // Only the explicitly previewed transaction crosses this boundary. No DB,
 // ledger state, cookies, screenshot filename or persistent key is available.
 const{type,config,apiKey,payload,imageDataUrl}=event.data;
 try{const request=type==='conversation'?requestAIConversation:requestAIExtraction;const result=await request(config,{apiKey,payload,imageDataUrl});self.postMessage({type:'result',result});}
 catch(error){const codes={config:'CONFIG',host:'CONFIG',key:'AUTH',payload:'RESPONSE',image:'IMAGE',mode:'CONFIG',network:'NETWORK',timeout:'TIMEOUT',cancelled:'ABORTED',auth:'AUTH',rate:'RATE_LIMIT',server:'RESPONSE',redirect:'NETWORK',response:'RESPONSE',size:'RESPONSE',vision:'VISION'};self.postMessage({type:'error',code:codes[error?.code]||'RESPONSE'});}
 finally{self.close();}
};
