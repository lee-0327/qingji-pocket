function node(tag,className,text=''){const value=document.createElement(tag);if(className)value.className=className;value.textContent=text;return value;}
function count(value){return Number.isSafeInteger(value)&&value>=0?value:0;}
function dateLabel(value){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'时间未知';}

/** Local history only. Loading and clearing chat never invokes AI or ledger writes.
 * The supplied renderer owns the live-ledger status of its read-only cards. */
export function createChatHistoryUI({host,store,getCurrentId,renderTurns,onBeforeOpen,onAfterClear}){
 const root=document.createElement('div');root.className='chat-history-root';
 root.innerHTML=`<dialog id="chat-history-dialog" class="sheet-dialog chat-history-dialog" aria-labelledby="chat-history-title">
  <div class="chat-history-heading"><div><p class="eyebrow">只保存在这台设备</p><h2 id="chat-history-title">聊天记录</h2></div><button id="chat-history-close" type="button" class="text-button">关闭</button></div>
  <p id="chat-history-status" class="chat-history-status" role="status" aria-live="polite"></p>
  <section id="chat-history-list-panel" class="chat-history-panel"><p class="chat-history-hint">查看之前发过的消息和账单卡片。打开记录不会再次请求 AI 或记账。</p><div id="chat-history-list" class="chat-history-list"></div></section>
  <section id="chat-history-detail" class="chat-history-panel" hidden><div class="chat-history-detail-heading"><button id="chat-history-back" type="button" class="text-button">← 返回列表</button><span class="subtle-tag">仅查看</span></div><h3 id="chat-history-detail-title"></h3><p id="chat-history-detail-date" class="chat-history-hint"></p><div id="chat-history-transcript" class="chat-messages chat-history-transcript" aria-label="历史对话"></div></section>
  <div class="chat-history-footer"><p>聊天记录单独保存在本机，不随账本备份导出；清空聊天不删账目。</p><button id="chat-history-clear" type="button" class="text-button chat-history-danger">清空聊天记录</button></div>
 </dialog><dialog id="chat-history-clear-dialog" class="sheet-dialog small-dialog" aria-labelledby="chat-history-clear-title"><h2 id="chat-history-clear-title">清空这台设备的聊天记录？</h2><p>将删除此浏览器保存的全部 AI 对话、图片缩略图和对话中的账单卡片，清空后无法恢复。已经记入账本的账目、接口配置和密钥保留；当前尚未发送的输入也会保留。</p><div class="dialog-actions"><button id="chat-history-clear-cancel" type="button" class="button secondary">先保留</button><button id="chat-history-clear-confirm" type="button" class="button secondary chat-history-danger">确认清空</button></div></dialog>`;
 host.append(root);
 const $=id=>root.querySelector('#'+id),dialog=$('chat-history-dialog'),confirm=$('chat-history-clear-dialog');
 let run=0,busy=false,opening=false,clearing=false,selectedId='',items=[];
 function status(text='',kind=''){$('chat-history-status').textContent=text;$('chat-history-status').dataset.kind=kind;}
 function sync(){for(const id of['chat-history-clear','chat-history-back'])$(id).disabled=busy||clearing;$('chat-history-clear').disabled=busy||clearing||!items.length;for(const id of['chat-history-clear-confirm','chat-history-clear-cancel','chat-history-close'])$(id).disabled=clearing;for(const button of $('chat-history-list').querySelectorAll('button'))button.disabled=busy||clearing;}
 function showList(){$('chat-history-list-panel').hidden=false;$('chat-history-detail').hidden=true;selectedId='';$('chat-history-transcript').replaceChildren();}
 function drawList(){const list=$('chat-history-list');list.replaceChildren();if(!items.length){const empty=node('div','chat-history-empty');empty.append(node('h3','','还没有保存的对话'),node('p','','从这版开始，发送过的文字、图片缩略图和记账结果会留在这里。'));list.append(empty);return;}
  for(const item of items){const button=node('button','chat-history-item');button.type='button';button.dataset.historyId=item.id;const heading=node('span','chat-history-item-heading');heading.append(node('strong','',item.title||'记账对话'));if(item.id===getCurrentId?.())heading.append(node('small','chat-history-current','当前对话'));button.append(heading,node('span','chat-history-item-date',dateLabel(item.updatedAt||item.createdAt)),node('span','chat-history-item-count',`${count(item.turnCount)} 条消息 · 当时记下 ${count(item.recordCount)} 笔`));list.append(button);}
 }
 async function loadList(){const ticket=++run;busy=true;showList();status('正在读取本机聊天记录…');sync();try{const result=await store.list();if(ticket!==run||!dialog.open)return;items=Array.isArray(result)?result:[];drawList();status('');}catch{if(ticket===run&&dialog.open){items=[];$('chat-history-list').replaceChildren();status('暂时无法读取聊天记录，请稍后重试。账本不受影响。','error');}}finally{if(ticket===run){busy=false;sync();}}}
 async function loadDetail(id,{preserve=false}={}){if(busy||clearing)return;const ticket=++run,scroll=$('chat-history-transcript').scrollTop;busy=true;selectedId=id;if(!preserve)status('正在打开这段对话…');sync();try{const value=await store.get(id);if(ticket!==run||!dialog.open)return;if(!value){status('这段记录已不存在，请返回列表重新查看。','error');return;}$('chat-history-list-panel').hidden=true;$('chat-history-detail').hidden=false;$('chat-history-detail-title').textContent=items.find(item=>item.id===id)?.title||'记账对话';$('chat-history-detail-date').textContent=dateLabel(value.updatedAt||value.createdAt);const transcript=$('chat-history-transcript');transcript.replaceChildren();renderTurns(transcript,value.turns||[],{readOnly:true});transcript.scrollTop=preserve?scroll:0;status('');if(!preserve)$('chat-history-back').focus();}catch{if(ticket===run&&dialog.open)status('暂时无法打开这段记录，请返回列表重试。','error');}finally{if(ticket===run){busy=false;sync();}}}
 async function refresh(){if(!dialog.open||clearing||busy)return;if(selectedId&&!$('chat-history-detail').hidden)await loadDetail(selectedId,{preserve:true});else await loadList();}
 async function open(){if(opening||clearing)return false;if(dialog.open){await refresh();return true;}opening=true;const ticket=++run;try{if(await onBeforeOpen?.('open')===false||ticket!==run)return false;dialog.showModal();await loadList();return true;}catch{if(ticket!==run)return false;if(!dialog.open)dialog.showModal();status('暂时无法准备聊天记录，请稍后重试。当前输入仍保留。','error');return false;}finally{opening=false;}}
 function close(){if(clearing)return false;run++;busy=false;selectedId='';if(confirm.open)confirm.close();if(dialog.open)dialog.close();$('chat-history-transcript').replaceChildren();sync();return true;}
 async function clear(){if(busy||clearing)return;clearing=true;sync();status('正在清空本机聊天记录…');let cleared=false;try{if(await onBeforeOpen?.('clear')===false){status('请先结束当前处理，再清空聊天记录。','error');return;}run++;await store.clear();cleared=true;items=[];showList();drawList();try{await onAfterClear?.();status('聊天记录已清空，账本和接口配置保留。');}catch{status('聊天记录已清空，请重新打开轻记以同步显示。账本和接口配置保留。','error');}}catch{status('未能清空聊天记录，请稍后重试。账本不受影响。','error');}finally{clearing=false;if(confirm.open)confirm.close();sync();if(cleared)$('chat-history-close').focus();}}
 $('chat-history-list').addEventListener('click',event=>{const button=event.target.closest('[data-history-id]');if(button&&$('chat-history-list').contains(button))loadDetail(button.dataset.historyId);});
 $('chat-history-back').addEventListener('click',()=>{if(!busy&&!clearing)loadList();});
 $('chat-history-close').addEventListener('click',close);
 $('chat-history-clear').addEventListener('click',()=>{if(!busy&&!clearing&&items.length)confirm.showModal();});
 $('chat-history-clear-cancel').addEventListener('click',()=>{if(!clearing)confirm.close();});
 $('chat-history-clear-confirm').addEventListener('click',clear);
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 confirm.addEventListener('cancel',event=>{if(clearing)event.preventDefault();});
 dialog.addEventListener('close',()=>{if(clearing)return;run++;busy=false;selectedId='';$('chat-history-transcript').replaceChildren();sync();});
 sync();
 return{open,refresh,close,isBusy:()=>busy||opening||clearing,isOpen:()=>dialog.open,isClearing:()=>clearing};
}
