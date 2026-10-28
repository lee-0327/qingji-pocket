import{validateAIConfig}from'./ai-client.js';

// Official API endpoints, verified against provider documentation 2026-10-28.
// These are choices, not a ranking, model cache, proxy or automatic fallback.
export const AI_PROVIDERS=Object.freeze([
 {id:'openai',name:'OpenAI · 官方',baseUrl:'https://api.openai.com/v1',docsUrl:'https://developers.openai.com/api/reference/resources/models/methods/list',note:'需使用 OpenAI API 密钥；ChatGPT 网页订阅不等于 API 额度。'},
 {id:'deepseek',name:'DeepSeek · 官方',baseUrl:'https://api.deepseek.com',docsUrl:'https://api-docs.deepseek.com/api/list-models/',note:'使用 DeepSeek 开放平台密钥。模型列表不代表本次模型推理已经测试。'},
 {id:'dashscope',name:'阿里云百炼 · 北京',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',docsUrl:'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',note:'使用北京地域密钥；官方仍支持此域名，也可自填业务空间专属域名。列表不支持时可手填模型。'},
 {id:'siliconflow',name:'硅基流动 · 中国站',baseUrl:'https://api.siliconflow.cn/v1',docsUrl:'https://docs.siliconflow.cn/docs/userguide/quickstart',note:'使用中国站密钥；列表可能含语音、向量或生图模型，请选择支持对话的模型。'},
 {id:'moonshot',name:'Kimi · 月之暗面',baseUrl:'https://api.moonshot.cn/v1',docsUrl:'https://platform.kimi.com/docs/get-api-key',note:'使用 Kimi API 开放平台密钥；需要模型实际支持所选文字或图片方式。'},
 {id:'zhipu',name:'智谱 · GLM',baseUrl:'https://open.bigmodel.cn/api/paas/v4',docsUrl:'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction',note:'使用开放平台 API 密钥；编程套餐和通用 API 的地址、权限可能不同。'},
 {id:'gemini',name:'Google · Gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',docsUrl:'https://ai.google.dev/gemini-api/docs/openai#list-models',note:'使用 Gemini API 密钥；OpenAI 兼容入口，地区和网络可达性由服务商决定。'},
 {id:'groq',name:'Groq · 官方',baseUrl:'https://api.groq.com/openai/v1',docsUrl:'https://console.groq.com/docs/models',note:'使用 GroqCloud 密钥；列表可能包含语音模型，请选择支持对话的模型。'},
].map(value=>Object.freeze(value)));

export const AI_PROVIDER_LIMITS=Object.freeze({timeoutMs:15000,responseBytes:256*1024,models:1000});
export const AI_PROVIDER_ERRORS=Object.freeze({
 config:'请填写可信的公开 HTTPS API 基础地址，移除地址中的账号、密钥、参数和片段。',
 key:'请填写有效 API 密钥，不要把密钥放进接口地址或模型名称。',
 'auth-required':'此服务需要先填写 API 密钥，才能获取模型列表；暂未验证接口或模型。',
 auth:'服务未接受此密钥，或密钥没有查询模型的权限。请检查账号、地域和 API 权限。',
 rate:'服务限制了模型查询频率或账号额度。没有自动重试，请稍后在服务商处检查。',
 network:'未能读取模型列表，请检查网络及服务商是否允许本站跨域访问。不会自动改用其他接口。',
 timeout:'模型查询超过 15 秒，已停止等待，没有自动重试。',
 cancelled:'已停止本次接口检测，没有保存新的配置。',
 unsupported:'此接口没有提供可用的兼容模型列表。可按官方文档手填模型，再选择其他检测方式或仅保存配置。',
 response:'模型列表格式不符合要求，暂未验证接口或模型。请查看服务商文档。',
 size:'模型列表返回内容过大，已停止读取，暂未验证接口或模型。',
 'model-missing':'接口可读取模型列表，但没有找到你选择的模型。请重新获取并选择模型。',
 redirect:'接口返回了跳转，已停止请求。请填写服务商提供的最终 API 基础地址。',
});

export function createAIProviderError(code='response'){
 const safe=Object.hasOwn(AI_PROVIDER_ERRORS,code)?code:'response';
 const error=new Error(AI_PROVIDER_ERRORS[safe]);error.code=safe;error.name=safe==='cancelled'?'AbortError':'AIProviderError';return error;
}
export function getAIProvider(id){return AI_PROVIDERS.find(value=>value.id===id)||null;}
export function matchAIProvider(baseUrl){try{const base=validateAIConfig({baseUrl,model:'models-list'}).baseUrl;return AI_PROVIDERS.find(value=>value.baseUrl===base)||null;}catch{return null;}}

function validateBase(baseUrl,apiKey){
 let selected;try{selected=validateAIConfig({baseUrl,model:'models-list'});}catch{throw createAIProviderError('config');}
 if(typeof apiKey!=='string'||(apiKey&&!/^[\x21-\x7E]{8,2048}$/.test(apiKey)))throw createAIProviderError('key');
 let decoded;try{decoded=decodeURIComponent(selected.baseUrl);}catch{throw createAIProviderError('config');}
 if(apiKey&&(selected.baseUrl.includes(apiKey)||decoded.includes(apiKey)))throw createAIProviderError('key');
 return{baseUrl:selected.baseUrl,endpoint:selected.baseUrl+'/models'};
}

async function readModels(response,apiKey){
 const announced=Number(response.headers.get('Content-Length'));
 if(Number.isFinite(announced)&&announced>AI_PROVIDER_LIMITS.responseBytes)throw createAIProviderError('size');
 const reader=response.body?.getReader();if(!reader)throw createAIProviderError('response');
 const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,body='';
 try{
  while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>AI_PROVIDER_LIMITS.responseBytes)throw createAIProviderError('size');body+=decoder.decode(part.value,{stream:true});}
  body+=decoder.decode();
 }catch(error){try{void reader.cancel().catch(()=>{});}catch{}if(error?.name==='AIProviderError')throw error;throw createAIProviderError('response');}
 finally{try{reader.releaseLock();}catch{}}
 if(apiKey&&body.includes(apiKey))throw createAIProviderError('response');
 let value;try{value=JSON.parse(body);}catch{throw createAIProviderError('response');}
 if(!value||typeof value!=='object'||!Array.isArray(value.data))throw createAIProviderError('response');
 if(value.data.length>AI_PROVIDER_LIMITS.models)throw createAIProviderError('size');
 const ids=[];
 for(const item of value.data){
  // IDs are code identifiers only. Names, owners and arbitrary metadata never
  // cross the worker boundary or become markup in a model picker.
  const id=item?.id;
  if(typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,149}$/.test(id))ids.push(id);
 }
 const models=[...new Set(ids)].sort();if(!models.length)throw createAIProviderError('response');return Object.freeze(models);
}

/** Explicit metadata request only. Call from the settings worker, not the UI.
 * One selected endpoint, one GET, no cookies, retries, redirects or inference. */
export async function listAIModels({baseUrl,apiKey='',signal}={}){
 const selected=validateBase(baseUrl,apiKey);if(signal?.aborted)throw createAIProviderError('cancelled');
 const controller=new AbortController();let rejectStop,timer;
 const stopped=new Promise((_,reject)=>{rejectStop=reject;});
 const stop=code=>{controller.abort();rejectStop(createAIProviderError(code));};
 const abort=()=>stop('cancelled');signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted)abort();
 timer=setTimeout(()=>stop('timeout'),AI_PROVIDER_LIMITS.timeoutMs);
 const request=async()=>{
  let response;
  try{response=await fetch(selected.endpoint,{method:'GET',headers:{Accept:'application/json',...(apiKey?{Authorization:'Bearer '+apiKey}:{})},signal:controller.signal,mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});}
  catch{throw createAIProviderError('network');}
  if(response.redirected||response.type==='opaqueredirect'||(response.status>=300&&response.status<400))throw createAIProviderError('redirect');
  if(response.url&&response.url!==selected.endpoint)throw createAIProviderError('redirect');
  if(response.status===401||response.status===403)throw createAIProviderError(apiKey?'auth':'auth-required');
  // Google's compatible list endpoint may return 404 before authentication.
  if(response.status===404&&!apiKey&&matchAIProvider(baseUrl)?.id==='gemini')throw createAIProviderError('auth-required');
  if([400,404,405,501].includes(response.status))throw createAIProviderError('unsupported');
  if(response.status===429)throw createAIProviderError('rate');
  if(!response.ok)throw createAIProviderError('response');
  return Object.freeze({...selected,models:await readModels(response,apiKey)});
 };
 try{return await Promise.race([request(),stopped]);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}

/** Checking a model listing never claims successful chat/image inference or
 * sufficient balance. A real inference test requires a separate explicit act. */
export async function probeAIConnection({baseUrl,model,mode='text',apiKey='',signal}={}){
 let config;try{config=validateAIConfig({baseUrl,model,mode});}catch{throw createAIProviderError('config');}
 if(typeof apiKey==='string'&&apiKey&&config.model.includes(apiKey))throw createAIProviderError('key');
 const listed=await listAIModels({baseUrl:config.baseUrl,apiKey,signal});
 if(!listed.models.includes(config.model))throw createAIProviderError('model-missing');
 return Object.freeze({baseUrl:listed.baseUrl,endpoint:listed.endpoint,model:config.model,scope:'models-access',modelListed:true,inferenceTested:false,visionTested:false});
}
