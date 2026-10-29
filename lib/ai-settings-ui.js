import{validateAIConfig}from'./ai-client.js';
import{getImageSupport}from'./ai-capabilities.js';
import{AI_PROVIDERS,getAIProvider,matchAIProvider,createAIProviderError}from'./ai-providers.js';
import{storeCredential,loadCredential,clearCredential}from'./ai-vault.js';
import{requestAISettings}from'./ai-settings-client.js';
const CONFIG_KEY='qingji-ai-settings-v1';

export function createAISettings({host,getConfig,getKey,onApply,onInvalidate}){
 const $=id=>host.querySelector('#'+id);
 let revision=0,controller=null,dirty=false,writing=false,storedKey=false,restoring=false,writingOwner=null;
 host.innerHTML=`<div class="setting-heading"><h2>AI 接口</h2><span class="subtle-tag">自行选择服务</span></div><p>先选服务商，再获取模型。大多数服务需先填密钥才能返回模型列表；不会自动替你切换接口。</p>
 <form id="ai-config-form" class="ai-config">
 <label class="form-label">1 · 选择服务商<select id="ai-provider"><option value="">请选择服务商</option></select></label>
 <p id="ai-provider-note" class="micro-copy"></p><a id="ai-provider-docs" class="text-link" target="_blank" rel="noreferrer" hidden>查看服务商官方文档 ↗</a>
 <label class="form-label">API 基础地址<input id="ai-base-url" type="url" maxlength="500" placeholder="https://你的接口地址/v1" autocomplete="off" spellcheck="false"></label>
 <div class="button-row"><button id="ai-fetch-models" type="button" class="button secondary">获取模型列表</button><button id="ai-cancel-detect" type="button" class="text-button" hidden>取消检测</button></div><p id="ai-models-status" class="micro-copy" role="status"></p>
 <label id="ai-model-select-row" class="form-label" hidden>3 · 从检测结果选择模型<select id="ai-model-select"><option value="">请选择模型</option></select></label>
 <label class="form-label">模型名称 · 也可手动填写<input id="ai-model" maxlength="150" placeholder="获取列表后选择，或填写官方模型 ID" autocomplete="off" spellcheck="false"></label>
 <p id="ai-model-support" class="micro-copy" role="status"></p>
 <label class="form-label">截图核对页的 AI 方式<select id="ai-mode"><option value="text">文字 · 发送预览文字</option><option value="image">文字与图片 · 需要模型支持识图</option></select></label>
 <label class="form-label">2 · API 密钥 · 多数服务需要先填<input id="ai-api-key" type="password" maxlength="2048" placeholder="填你自己的密钥，已有本次密钥可留空" autocomplete="off" spellcheck="false"></label>
 <p id="ai-key-state" class="micro-copy"></p>
 <label class="check-label"><input id="ai-remember-config" type="checkbox" checked>记住这台设备上的地址和模型</label>
 <label class="check-label"><input id="ai-remember-key" type="checkbox">同时在本机记住密钥，下次自动恢复</label>
 <p class="micro-copy">密钥可选加密保存在当前浏览器，不进入账本或备份。共享设备不要开启；网站代码或扩展仍可能访问密钥，不能保证绝对安全。</p>
 <label class="check-label"><input id="ai-test-reply" type="checkbox">检测时也测试 AI 回复：发送 1 次小请求，可能产生少量费用，不发送账单</label>
 <p id="ai-detection-target" class="micro-copy"></p>
 <div class="button-row"><button id="ai-test-save" type="submit" class="button primary">检测并保存</button><button id="ai-save-config" type="button" class="button secondary">仅保存，不检测</button></div>
 <p id="ai-config-status" class="micro-copy" role="status" aria-live="polite"></p>
 <div class="button-row"><button id="ai-forget-key" type="button" class="text-button">忘记密钥</button><button id="ai-reset-config" type="button" class="text-button">清除接口配置</button></div>
 </form><p class="micro-copy">默认检测只查询模型列表，不验证 AI 回复或图片能力。若服务不开放模型列表，可以手填模型后仅保存，或主动勾选测试回复。浏览器跨域限制、模型权限和费用由服务商决定。</p><a class="text-link" href="./help.html#ai">接口用法和数据范围 ↗</a>`;
 const keyLabel=$('ai-api-key').closest('label');$('ai-fetch-models').closest('.button-row').before(keyLabel,$('ai-key-state'));
 const domestic=new Set(['deepseek','dashscope','siliconflow','moonshot','zhipu']);
 for(const [label,items]of[['国内服务',AI_PROVIDERS.filter(p=>domestic.has(p.id))],['国际服务',AI_PROVIDERS.filter(p=>!domestic.has(p.id))]]){const group=document.createElement('optgroup');group.label=label;for(const provider of items)group.append(new Option(provider.name,provider.id));$('ai-provider').append(group);}$('ai-provider').append(new Option('自定义兼容接口','custom'));
 function status(text,kind=''){$('ai-config-status').textContent=text;$('ai-config-status').dataset.kind=kind;}
 function providerNote(){const provider=getAIProvider($('ai-provider').value);$('ai-provider-note').textContent=provider?.note||'支持 Chat Completions 格式的公开 HTTPS 接口；请确认地址属于你信任的服务。';$('ai-provider-docs').hidden=!provider;if(provider)$('ai-provider-docs').href=provider.docsUrl;else $('ai-provider-docs').removeAttribute('href');}
 function clearModels(){$('ai-model-select').replaceChildren(new Option('请选择模型',''));$('ai-model-select-row').hidden=true;$('ai-models-status').textContent='';}
 function sync(){const support=getImageSupport({baseUrl:$('ai-base-url').value,model:$('ai-model').value});$('ai-model-support').textContent=support.supported===null?'':support.reason;const running=Boolean(controller);for(const id of['ai-fetch-models','ai-test-save','ai-save-config'])$(id).disabled=running||writing||restoring;$('ai-cancel-detect').hidden=!running;$('ai-remember-key').disabled=!$('ai-remember-config').checked;$('ai-reset-config').disabled=writing;$('ai-forget-key').disabled=writing||(!getKey()&&!storedKey&&!$('ai-api-key').value);$('ai-api-key').placeholder=getKey()?'本次密钥已就绪；填写可替换':'填你自己的 API 密钥';$('ai-key-state').textContent=storedKey?'当前浏览器已记住密钥，可在下次打开时恢复。':getKey()?'本次密钥已就绪，关闭后需重填。':'尚未填写密钥；需要时只发送给上方选定的接口。';for(const field of host.querySelectorAll('input,select'))field.disabled=writing||(restoring&&!['ai-provider','ai-base-url','ai-api-key'].includes(field.id))||(field.id==='ai-remember-key'&&!$('ai-remember-config').checked);}
 function cancel(note=true){revision++;restoring=false;controller?.abort();controller=null;sync();if(note)status('已取消检测，没有保存。已经发出的测试请求仍可能被服务商处理。');}
 function target(){try{const config=readConfig(false);$('ai-detection-target').textContent=`检测目标：${config.baseUrl}${$('ai-test-reply').checked?'/chat/completions · 测试一次回复':'/models · 仅查询列表'}`;}catch{$('ai-detection-target').textContent='检测只发送到你选定的 API 地址，不经过公共转发。';}}
 function edit({targetChanged=false,modelsChanged=false}={}){cancel(false);dirty=true;if(targetChanged){$('ai-api-key').value='';$('ai-remember-key').checked=false;onInvalidate(true);}else onInvalidate(false);if(modelsChanged)clearModels();$('ai-test-reply').checked=false;status('配置已修改；检测或保存后生效。');target();sync();}
 function readConfig(requireModel=true){return validateAIConfig({baseUrl:$('ai-base-url').value,model:requireModel?$('ai-model').value:($('ai-model').value||'model-list'),mode:$('ai-mode').value});}
 function readKey(config){const entered=$('ai-api-key').value.trim();const same=getConfig()?.baseUrl===config.baseUrl;const key=entered||(same?getKey():'');if(key&&!/^[\x21-\x7E]{8,2048}$/.test(key))throw createAIProviderError('key');if(key&&(decodeURIComponent(config.endpoint).includes(key)||config.model.includes(key)))throw createAIProviderError('key');return key;}
 function applyModels(models){$('ai-model-select').replaceChildren(new Option('请选择模型',''));for(const id of models){const support=getImageSupport({baseUrl:$('ai-base-url').value,model:id});$('ai-model-select').append(new Option(id+(support.supported===false?' · 仅文字':support.supported===true?' · 支持图片':''),id));}$('ai-model-select-row').hidden=!models.length;if(models.includes($('ai-model').value))$('ai-model-select').value=$('ai-model').value;}
 async function discover(){if(writing||restoring||controller)return;cancel(false);const run=revision;try{const config=readConfig(false),key=readKey(config);controller=new AbortController();sync();$('ai-models-status').textContent='正在向所选服务获取模型…';const result=await requestAISettings('models',{config,apiKey:key,signal:controller.signal});if(run!==revision)return;applyModels(result.models);$('ai-models-status').textContent=`服务返回 ${result.models.length} 个模型。请按用途选择模型；已确认的图片能力会标注，其他模型需查看服务商说明。`;status('模型列表已获取，还没有保存配置。');}catch(error){if(run===revision){$('ai-models-status').textContent=error.message||'未能获取模型，请检查地址和密钥。';status('没有自动选择其他服务或模型。','error');}}finally{if(run===revision){controller=null;sync();}}}
 async function persist(config,key){
  const remember=$('ai-remember-config').checked,rememberKey=remember&&$('ai-remember-key').checked;
  if(rememberKey&&!key)throw createAIProviderError('key');
  let previous;
  try{previous=localStorage.getItem(CONFIG_KEY);if(remember)localStorage.setItem(CONFIG_KEY,JSON.stringify({baseUrl:config.baseUrl,model:config.model,mode:config.mode,rememberKey}));else localStorage.removeItem(CONFIG_KEY);}
  catch{throw new Error('浏览器未能保存配置，原有密钥未被替换。请检查存储权限与可用空间。');}
  try{if(rememberKey){await storeCredential({baseUrl:config.baseUrl,apiKey:key});storedKey=true;}else if(storedKey){await clearCredential();storedKey=false;}}
  catch(error){try{if(previous===null)localStorage.removeItem(CONFIG_KEY);else localStorage.setItem(CONFIG_KEY,previous);}catch{}throw error;}
 }
 async function save(test){if(writing||restoring||controller)return;cancel(false);const run=revision;let config,key;try{config=readConfig();key=readKey(config);if($('ai-remember-key').checked&&!key)throw createAIProviderError('key');let verified='未检测，仅按填写内容保存。';if(test){controller=new AbortController();sync();const reply=$('ai-test-reply').checked;status(reply?'正在测试一次 AI 回复，不发送账单…':'正在检查接口和所选模型…');await requestAISettings(reply?'reply':'probe',{config,apiKey:key,signal:controller.signal});if(run!==revision)return;verified=reply?'AI 文字回复测试通过；图片能力仍需实际核对。':'接口与模型列表检查通过；未测试 AI 回复和图片能力。';}
   if(run!==revision)return;controller=null;writing=true;writingOwner=run;sync();await persist(config,key);if(run!==revision)return;onApply(config,key);$('ai-api-key').value='';dirty=false;$('ai-test-reply').checked=false;status(verified+($('ai-remember-config').checked?' 已保存到当前浏览器。':' 仅本次页面使用。')+(storedKey?' 密钥也已在本机记住。':''));
  }catch(error){if(run===revision)status(error?.name==='AICredentialError'?'本机密钥未能保存或清除，未降级为明文。请检查浏览器存储，或重试。':error.message||'检测未通过，没有保存本次配置。','error');}
  finally{if(writingOwner===run){writing=false;writingOwner=null;}if(run===revision)controller=null;sync();target();}
 }
 async function forget(reset=false){
  if(writing)return;const keep=getConfig(),wasDirty=dirty;cancel(false);dirty=true;onInvalidate(true);$('ai-api-key').value='';const run=revision;writing=true;writingOwner=run;sync();
  try{
   await clearCredential();storedKey=false;$('ai-remember-key').checked=false;let metadataWarning='';
   try{if(reset)localStorage.removeItem(CONFIG_KEY);else{const previous=JSON.parse(localStorage.getItem(CONFIG_KEY)||'null');if(previous){const prior=validateAIConfig(previous);localStorage.setItem(CONFIG_KEY,JSON.stringify({baseUrl:prior.baseUrl,model:prior.model,mode:prior.mode,rememberKey:false}));}}}
   catch{metadataWarning=' 密钥已删除，但配置标记未能更新；下次可能提示重填。';}
   if(reset){$('ai-provider').value='';$('ai-base-url').value='';$('ai-model').value='';$('ai-mode').value='text';clearModels();onApply(null,'');dirty=false;providerNote();}else{if(keep)onApply(keep,'');dirty=wasDirty;}
   status((reset?'本次与已保存的密钥已删除，接口表单已清空。':'本次及已保存的密钥已删除，地址和模型保留。')+metadataWarning,metadataWarning?'error':'');
  }catch{status('未能清除已保存的密钥，请重试。没有假装清除成功。','error');}
  finally{if(writingOwner===run){writing=false;writingOwner=null;}sync();target();}
 }
 $('ai-provider').addEventListener('change',()=>{const provider=getAIProvider($('ai-provider').value);$('ai-base-url').value=provider?.baseUrl||'';$('ai-model').value='';edit({targetChanged:true,modelsChanged:true});providerNote();});
 $('ai-base-url').addEventListener('input',()=>{$('ai-provider').value='custom';edit({targetChanged:true,modelsChanged:true});providerNote();});
 $('ai-model').addEventListener('input',()=>edit());$('ai-mode').addEventListener('change',()=>edit());$('ai-api-key').addEventListener('input',()=>edit({modelsChanged:true}));
 $('ai-model-select').addEventListener('change',()=>{if($('ai-model-select').value){$('ai-model').value=$('ai-model-select').value;edit();}});
 $('ai-remember-config').addEventListener('change',()=>{if(!$('ai-remember-config').checked)$('ai-remember-key').checked=false;edit();});$('ai-remember-key').addEventListener('change',()=>edit());
 $('ai-test-reply').addEventListener('change',()=>{cancel(false);dirty=true;target();});
 $('ai-fetch-models').addEventListener('click',discover);$('ai-cancel-detect').addEventListener('click',()=>cancel());$('ai-config-form').addEventListener('submit',event=>{event.preventDefault();save(true);});$('ai-save-config').addEventListener('click',()=>save(false));$('ai-forget-key').addEventListener('click',()=>forget());$('ai-reset-config').addEventListener('click',()=>forget(true));
 const initial=getConfig();if(initial){$('ai-base-url').value=initial.baseUrl;$('ai-model').value=initial.model;$('ai-mode').value=initial.mode;$('ai-provider').value=matchAIProvider(initial.baseUrl)?.id||'custom';}
 providerNote();target();sync();status(initial?'地址和模型已恢复；可重新获取模型或检测连接。':'尚未配置；本地记账可直接使用。');
 try{const saved=JSON.parse(localStorage.getItem(CONFIG_KEY)||'null');storedKey=Boolean(saved?.rememberKey&&initial);if(storedKey){const restoreRun=revision;restoring=true;$('ai-remember-key').checked=true;sync();status('正在从本机恢复密钥…');loadCredential(initial.baseUrl).then(key=>{if(restoreRun!==revision)return;restoring=false;if(getKey()||getConfig()?.baseUrl!==initial.baseUrl){sync();return;}if(key){onApply(initial,key);$('ai-remember-key').checked=true;status('配置与密钥已从本机恢复，尚未联网。');}else{storedKey=false;$('ai-remember-key').checked=false;status('没有找到本机密钥，请重新填写。');}sync();}).catch(()=>{if(restoreRun===revision){restoring=false;status('本机密钥无法恢复，请重新填写；也可点“忘记密钥”清除旧记录。','error');sync();}});}}catch{}
 window.addEventListener('pagehide',()=>cancel(false));
 return{setStatus:status,refreshKeyState:sync,invalidateRestore(){revision++;},cancel:()=>cancel(false),isBusy:()=>Boolean(controller)||writing,hasUnsavedWork:()=>dirty||Boolean($('ai-api-key').value)};
}
