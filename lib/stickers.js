// Original watercolor cat illustrations are arranged in one local 4 × 4 atlas.
// Category labels and amounts remain real text; the artwork is decorative.
const NAMES=['meal','transport','shopping','home','daily','health','fun','other','coffee','tea','groceries','book','income','refund','capture','empty'];
const CATEGORIES={'餐饮':'meal','交通':'transport','购物':'shopping','住房':'home','日用':'daily','健康':'health','娱乐':'fun','其他':'other'};

export function sticker(name,className=''){
 const key=NAMES.includes(name)?name:'other';
 const index=NAMES.indexOf(key);
 const position=number=>Number((number*100/3).toFixed(6));
 const extra=String(className).replace(/[^A-Za-z0-9 _-]/g,'').trim();
 return`<span class="cat-sticker cat-${key}${extra?' '+extra:''}" style="--cat-position:${position(index%4)}% ${position(Math.floor(index/4))}%" aria-hidden="true"></span>`;
}

export function categorySticker(category,className=''){return sticker(CATEGORIES[category]||'other',className);}

export function recordSticker(record={},className=''){
 if(record.type==='income')return sticker('income',className);
 if(record.type==='refund')return sticker('refund',className);
 const context=`${record.purpose||''} ${record.merchant||''}`;
 if(record.category==='餐饮'){
  if(/咖啡|瑞幸|星巴克/.test(context))return sticker('coffee',className);
  if(/奶茶|茶饮|果茶/.test(context))return sticker('tea',className);
  if(/买菜|菜市场|蔬菜|生鲜/.test(context))return sticker('groceries',className);
 }
 if(['购物','娱乐','其他'].includes(record.category)&&/买书|书店|书籍|书本|读书/.test(context))return sticker('book',className);
 return categorySticker(record.category,className);
}

export function renderStickers(root=document){root.querySelectorAll('[data-sticker]').forEach(el=>{el.innerHTML=sticker(el.dataset.sticker,el.dataset.stickerClass||'');});}
