// Official DeepSeek model capabilities checked on 2026-10-29:
// https://api-docs.deepseek.com/api/list-models/
// This is a narrow guard, not model discovery, a fallback, or a model switch.
const UNKNOWN=Object.freeze({supported:null,reason:'暂未确认这个接口与模型的图片能力。'});
const DEEPSEEK_FLASH=Object.freeze({supported:true,reason:'deepseek-flash 支持文字和图片输入。'});
const DEEPSEEK_PRO=Object.freeze({
 supported:false,
 reason:'deepseek-v4-pro 只支持文字，不能直接识别图片；请选择支持图片的模型，或用首页“截图记账”。',
 alternative:'deepseek-flash',
});

/** Only the exact official origin can use this provider-specific capability.
 * Custom endpoints and unrecognised model IDs remain unknown; never infer
 * their behaviour from a model name alone. No network, credential or storage. */
export function getImageSupport(options={}){
 if(!options||typeof options!=='object'||Array.isArray(options))return UNKNOWN;
 try{
  const raw=options.baseUrl??options.origin;
  if(typeof raw!=='string'||!raw||/[\s\\]/.test(raw)||typeof options.model!=='string')return UNKNOWN;
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.origin!=='https://api.deepseek.com')return UNKNOWN;
  const model=options.model.trim();
  if(model==='deepseek-flash')return DEEPSEEK_FLASH;
  if(model==='deepseek-v4-pro')return DEEPSEEK_PRO;
 }catch{ /* Invalid settings get no capability assertion or raw error. */ }
 return UNKNOWN;
}
