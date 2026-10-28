/** Local-only bookkeeping rules. No DOM, network, storage or model calls. */
export const CATEGORIES = Object.freeze(['餐饮', '交通', '购物', '住房', '日用', '健康', '娱乐', '其他']);
const TYPES = new Set(['expense', 'income', 'refund', 'transfer']);
const CHANNELS = new Set(['微信', '支付宝', '其他']);
const SOURCES = new Set(['text', 'ocr', 'import', 'manual']);
const CN = '零〇一二两三四五六七八九十百千万亿';
const DIGITS = Object.freeze({零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9});
const NUMBER = `(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|[${CN}]+(?:点[零〇一二两三四五六七八九]+)?`;
const CURRENCY_FOREIGN = /美元|美金|欧元|港币|港元|日元|英镑|\b(?:USD|EUR|HKD|JPY|GBP)\b|(?:US|HK)\$|[€£]/i;
const FAILURE = /支付失败|付款失败|交易失败|交易关闭|订单关闭|待支付|待付款|等待付款|未付款|退款处理中|退款申请中|退款中/;
const COMPLETE = /支付成功|付款成功|交易成功|交易完成|已完成|已支付|消费成功/;
const INCOME = /收款成功|收款到账|收入到账|工资到账|已收款/;
const REFUND = /退款成功|退款到账|退款已到账|已退款|已退回/;
const TRANSFER = /转账|提现|还信用卡|信用卡还款|充值|借给|借款|还给/;
const KEYWORDS = [
  ['餐饮', /餐饮|午饭|午餐|晚饭|晚餐|早饭|早餐|夜宵|吃饭|点餐|堂食|外卖|餐厅|饭店|小面|面馆|拉面|米线|米粉|粉面|螺蛳粉|麻辣烫|麻辣香锅|烧烤|火锅|快餐|简餐|小吃|粥店|包子|饺子|馄饨|肠粉|汉堡|披萨|炸鸡|自助餐|日料|料理|寿司|烘焙|面包店|蛋糕|甜品|冰淇淋|咖啡|奶茶|茶饮|瑞幸|星巴克|肯德基|麦当劳|买菜|水果/i],
  ['交通', /交通|地铁|公交|高铁|铁路|火车|动车|机票|飞机票|汽车票|客运|滴滴|打车|出租车|网约车|顺风车|停车|通行费|高速|加油|车费|共享单车|哈啰|青桔|充电桩|中石化|中石油|\bETC\b/i],
  ['购物', /购物|衣服|衣裤|服装|鞋子|鞋店|运动鞋|箱包|饰品|珠宝|美妆|化妆品|数码|手机|电器|家具|电脑|文具|优衣库|无印良品|宜家|耐克|阿迪达斯/i],
  ['住房', /住房|房租|物业|水费|电费|燃气|供暖|房贷/],
  ['日用', /日用|超市|便利店|纸巾|洗衣液|洗发水|洗衣|百货|永辉|沃尔玛|山姆|便利蜂|罗森便利|全家便利|7-Eleven/i],
  ['健康', /健康|医院|药店|药房|挂号|诊疗|体检|看病|牙科|口腔|买药|诊所/i],
  ['娱乐', /娱乐|电影|影院|游戏|游乐园|演唱会|门票|书店/],
];
const TEXT = (value) => String(value ?? '').normalize('NFKC').replace(/\r\n?/g, '\n').replace(/−/g, '-');
const CLEAN = (value, max = 160) => TEXT(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const getNow = (opts = {}) => opts.now instanceof Date && Number.isFinite(opts.now.getTime()) ? new Date(opts.now) : new Date();
const safeCents = (n) => Number.isSafeInteger(n);
const isPositiveCents = (n) => safeCents(n) && n > 0;

function chineseInteger(text) {
  if (!text || !new RegExp(`^[${CN}]+$`).test(text)) return null;
  if (!/[十百千万亿]/.test(text)) {
    const s = [...text].map((c) => DIGITS[c]).join('');
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : null;
  }
  let total = 0; let section = 0; let digit = 0;
  for (const c of text) {
    if (Object.hasOwn(DIGITS, c)) { digit = DIGITS[c]; continue; }
    const small = {十: 10, 百: 100, 千: 1000}[c];
    if (small) { section += (digit || 1) * small; digit = 0; continue; }
    const big = c === '万' ? 10000 : 100000000;
    section += digit;
    if (c === '亿') total = (total + section) * big;
    else total += section * big;
    section = 0; digit = 0;
  }
  const result = total + section + digit;
  return Number.isSafeInteger(result) ? result : null;
}

/** Exact decimal parsing; signed cents are allowed here, records use positive cents. */
export function parseMoney(input) {
  if (input === null || input === undefined || typeof input === 'boolean') return null;
  let s = TEXT(input).trim();
  if (!s || CURRENCY_FOREIGN.test(s) || /[eE]/.test(s)) return null;
  let sign = 1;
  if (s.startsWith('(') && s.endsWith(')')) { sign = -1; s = s.slice(1, -1).trim(); if (/^[+-]/.test(s)) return null; }
  s = s.replace(/^(?:人民币|RMB|CNY)\s*/i, '').replace(/\s*(?:人民币|RMB|CNY)$/i, '');
  const signed = s.match(/^([+-])?\s*[¥￥]?\s*([+-])?\s*(.+)$/);
  if (!signed) return null;
  if (signed[1] && signed[2]) return null;
  if ((signed[1] || signed[2]) === '-') sign *= -1;
  s = signed[3].replace(/\s+/g, '').replace(/块钱/g, '块');
  // Explicit yuan/jiao/fen, including 18元5角6分 and colloquial 18块5.
  if (/[元块角毛分]/.test(s)) {
    const parts = s.match(new RegExp(`^([\\d,]+(?:\\.\\d+)?|[${CN}]+(?:点[零〇一二两三四五六七八九]+)?)(?:元|块)(?:([\\d零〇一二两三四五六七八九]+)(角|毛|分)?)?(?:([\\d零〇一二两三四五六七八九]+)分)?$`));
    if (!parts) return null;
    const base = parseMoney(parts[1]);
    if (base === null || base < 0) return null;
    let fraction = 0;
    if (parts[2]) {
      const p = /^\d+$/.test(parts[2]) ? Number(parts[2]) : chineseInteger(parts[2]);
      if (p === null) return null;
      if (parts[3] === '分') { if (p > 9) return null; fraction += p; }
      else if (parts[3]) { if (p > 9) return null; fraction += p * 10; }
      else { if (parts[2].length > 2 || p > 99) return null; fraction += parts[2].length === 1 ? p * 10 : p; }
    }
    if (parts[4]) {
      const p = /^\d+$/.test(parts[4]) ? Number(parts[4]) : chineseInteger(parts[4]);
      if (p === null || p > 9) return null;
      fraction += p;
    }
    if (fraction && base % 100) return null;
    return safeCents(base + fraction) ? sign * (base + fraction) : null;
  }
  if (/[点零〇一二两三四五六七八九十百千万亿]/.test(s)) {
    const [whole, decimals, extra] = s.split('点');
    const n = chineseInteger(whole);
    if (n === null || extra !== undefined) return null;
    let d = '';
    if (decimals !== undefined) {
      if (!/^[零〇一二两三四五六七八九]{1,2}$/.test(decimals)) return null;
      d = [...decimals].map((x) => DIGITS[x]).join('');
    }
    const value = BigInt(n) * 100n + BigInt(d.padEnd(2, '0') || '0');
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? sign * Number(value) : null;
  }
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(s)) return null;
  const [whole, fractional = ''] = s.replace(/,/g, '').split('.');
  const cents = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0'));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? sign * Number(cents) : null;
}

export function formatMoney(cents) {
  if (!safeCents(cents)) return '—';
  const absolute = Math.abs(cents);
  const yuan = String(Math.trunc(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}¥${yuan}.${String(absolute % 100).padStart(2, '0')}`;
}

function validDate(s) {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return false;
  const [, y, mo, day, h = '00', mi = '00', sec = '00'] = m;
  const check = new Date(Number(y), Number(mo) - 1, Number(day), Number(h), Number(mi), Number(sec));
  return check.getFullYear() === Number(y) && check.getMonth() + 1 === Number(mo) && check.getDate() === Number(day) && Number(h) < 24 && Number(mi) < 60 && Number(sec) < 60;
}

function dateInfo(text, now, { inherit, ocr = false } = {}) {
  const spans = [];
  const dates = [];
  const pattern = /(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:[ T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/g;
  for (const match of text.matchAll(pattern)) {
    spans.push([match.index, match.index + match[0].length]);
    const d = `${match[1]}-${pad(Number(match[2]))}-${pad(Number(match[3]))}${match[4] !== undefined ? `T${pad(Number(match[4]))}:${match[5]}:${match[6] || '00'}` : ''}`;
    dates.push(d);
  }
  if (dates.length) {
    const unique = [...new Set(dates)];
    return { date: validDate(unique[0]) ? unique[0] : localDate(now), spans, explicit: true, reason: unique.length > 1 ? '截图中存在多个日期，请核对交易日期' : validDate(unique[0]) ? '' : '日期无效，请补全正确日期' };
  }
  const rel = text.match(/今天|昨天|前天|大前天|明天|后天/);
  if (rel) {
    spans.push([rel.index, rel.index + rel[0].length]);
    const delta = {今天: 0, 昨天: -1, 前天: -2, 大前天: -3, 明天: 1, 后天: 2}[rel[0]];
    const date = new Date(now); date.setDate(date.getDate() + delta);
    return { date: localDate(date), spans, explicit: true, reason: delta > 0 ? '这是未来日期，请确认交易已经发生' : '' };
  }
  for (const m of text.matchAll(/\d{1,2}月\d{1,2}日?|\d{1,2}:\d{2}(?::\d{2})?/g)) spans.push([m.index, m.index + m[0].length]);
  if (/\d{1,2}月\d{1,2}日?/.test(text)) return { date: localDate(now), spans, explicit: false, reason: '日期缺少年份，请核对后补全' };
  return { date: inherit || (ocr ? localTime(now) : localDate(now)), spans, explicit: false, reason: '', estimated: ocr };
}

function channelOf(text) {
  const wechat = /微信|财付通|WeChat|零钱/.test(text);
  const alipay = /支付宝|Alipay|花呗|余额宝/.test(text);
  return wechat && !alipay ? '微信' : alipay && !wechat ? '支付宝' : '其他';
}

export function classify(merchant, text = '', rules = {}) {
  return classificationEvidence(merchant, text, rules).category;
}

function classificationEvidence(merchant, text = '', rules = {}) {
  const key = CLEAN(merchant).toLocaleLowerCase();
  for (const [name, category] of Object.entries(rules || {})) {
    if (CATEGORIES.includes(category) && CLEAN(name).toLocaleLowerCase() === key && key && key !== '未识别商户') return { category, basis: `按你记住的“${CLEAN(merchant)}”分类：${category}` };
  }
  for (const [source, label] of [[CLEAN(merchant), '商户'], [CLEAN(text, 1000), '商品或用途']]) {
    for (const [category, pattern] of KEYWORDS) {
      const match = source.match(pattern);
      if (match) return { category, basis: `${label}含“${match[0]}”，建议${category}` };
    }
  }
  return { category: '其他', basis: '没有足够的商户或商品线索，分类请手动选择' };
}

/** Suggestions are local rules, not verified facts. Never infer a meal from the
 * capture clock, a date without time, another type of transaction or a user's
 * non-food category. `basis` and `timeBasis` are temporary UI explanation only.
 */
export function inferReceiptContext(record = {}, opts = {}) {
  const merchant = CLEAN(record.merchant);
  const goods = CLEAN(opts.goods || '', 1000);
  const evidence = classificationEvidence(merchant, goods, opts.rules);
  const chosenCategory = CATEGORIES.includes(record.category) && record.category !== '其他' ? record.category : '';
  const category = chosenCategory || evidence.category;
  const basis = [chosenCategory && chosenCategory !== evidence.category ? `沿用你选择的分类：${chosenCategory}` : evidence.basis];
  const existingPurpose = CLEAN(record.purpose, 40);
  if (existingPurpose) return { category, purpose: existingPurpose, basis, timeBasis: '' };
  if (category !== '餐饮' || record.type !== 'expense') return { category, purpose: '', basis, timeBasis: '' };
  const context = `${merchant} ${goods}`;
  const explicit = [
    ['咖啡', /咖啡|瑞幸|星巴克/], ['奶茶', /奶茶|茶饮/], ['水果', /水果/], ['买菜', /买菜/],
  ].find(([, pattern]) => pattern.test(context)) || [
    ['早饭', /早饭|早餐/], ['午饭', /午饭|午餐/], ['晚饭', /晚饭|晚餐/], ['夜宵', /夜宵/],
  ].find(([, pattern]) => pattern.test(goods));
  if (explicit) {
    basis.push(`商户或商品含“${context.match(explicit[1])[0]}”，建议用途为${explicit[0]}`);
    return { category, purpose: explicit[0], basis, timeBasis: '' };
  }
  const timestamp = String(record.date || '');
  const time = timestamp.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):\d{2}$/);
  const uncertainTime = /采集时间|暂按|缺少年份|日期无效|存在多个日期|未来日期/.test(String(record.notes || ''));
  if (!time || !validDate(timestamp) || uncertainTime || opts.explicitTime === false) return { category, purpose: '', basis, timeBasis: '' };
  const minutes = Number(time[1]) * 60 + Number(time[2]);
  let purpose = '';
  if (minutes >= 300 && minutes < 630) purpose = '早饭';
  else if (minutes >= 630 && minutes < 900) purpose = '午饭';
  else if (minutes >= 1020 && minutes < 1260) purpose = '晚饭';
  else if (minutes >= 1260 || minutes < 300) purpose = '夜宵';
  if (!purpose) return { category, purpose: '', basis, timeBasis: '' };
  const timeBasis = `付款时间 ${time[1]}:${time[2]}，按你的规则建议${purpose}，可修改`;
  basis.push(timeBasis);
  return { category, purpose, basis, timeBasis };
}

export function normalizeRecord(draft = {}, opts = {}) {
  const now = getNow(opts);
  const stamp = now.toISOString();
  const randomId = () => globalThis.crypto?.randomUUID?.() || `qj-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const amount = typeof draft.amountCents === 'string' && /^-?\d+$/.test(draft.amountCents) ? Number(draft.amountCents) : draft.amountCents;
  return {
    id: CLEAN(draft.id) || randomId(),
    date: draft.date === undefined || draft.date === null || draft.date === '' ? localDate(now) : TEXT(draft.date).trim(),
    amountCents: safeCents(amount) ? amount : null,
    type: draft.type || 'expense',
    merchant: CLEAN(draft.merchant) || '未识别商户',
    purpose: CLEAN(draft.purpose, 40),
    category: draft.category || '其他',
    channel: draft.channel || '其他',
    source: draft.source || 'manual',
    sourceId: CLEAN(draft.sourceId),
    notes: CLEAN(draft.notes, 500),
    status: draft.status || 'pending',
    createdAt: typeof draft.createdAt === 'string' && Number.isFinite(Date.parse(draft.createdAt)) ? draft.createdAt : stamp,
    updatedAt: stamp,
  };
}

export function validateRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') return ['记录格式不正确'];
  if (typeof record.id !== 'string' || !record.id.trim()) errors.push('缺少记录编号');
  if (!validDate(record.date)) errors.push('请输入有效的交易日期');
  if (!isPositiveCents(record.amountCents)) errors.push('请输入大于零且精确到分的金额');
  if (!TYPES.has(record.type)) errors.push('请选择有效的收支类型');
  if (typeof record.merchant !== 'string' || !record.merchant.trim()) errors.push('请填写商户或用途');
  if (record.purpose !== undefined && typeof record.purpose !== 'string') errors.push('用途格式不正确');
  if (!CATEGORIES.includes(record.category)) errors.push('请选择有效的分类');
  if (!CHANNELS.has(record.channel)) errors.push('请选择有效的支付渠道');
  if (!SOURCES.has(record.source)) errors.push('记录来源不正确');
  if (!['confirmed', 'pending'].includes(record.status)) errors.push('记录状态不正确');
  if (typeof record.sourceId !== 'string' || typeof record.notes !== 'string') errors.push('记录说明格式不正确');
  for (const key of ['createdAt', 'updatedAt']) if (typeof record[key] !== 'string' || !Number.isFinite(Date.parse(record[key]))) errors.push('记录时间格式不正确');
  return [...new Set(errors)];
}

function moneyCandidates(text, spans = []) {
  const pattern = new RegExp(`[+-]?(?:[¥￥]\\s*)?(?:${NUMBER})(?:\\s*(?:元|块(?:钱)?|人民币|RMB|CNY))?(?:\\s*[\\d零〇一二两三四五六七八九]+(?:角|毛|分))?`, 'g');
  const candidates = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index; const end = start + match[0].length;
    if (spans.some(([a, b]) => start < b && end > a)) continue;
    if (/^(?:个|杯|瓶|斤|份|张|件|套|次|公里|分钟|小时|天|年|月|日|折)/.test(text.slice(end).trimStart())) continue;
    // Phone numbers, order IDs, percentages, decimal precision and exponents are not money.
    if (/[\d.A-Za-z%]/.test(text[end] || '') || /[A-Za-z\d]/.test(text[start - 1] || '')) continue;
    if (/^\d{7,}$/.test(match[0]) && !/[元块¥￥]|花|付|收入|工资|退款/.test(text)) continue;
    const cents = parseMoney(match[0]);
    if (cents !== null) candidates.push({ cents: Math.abs(cents), start, end, raw: match[0] });
  }
  return candidates;
}

function merchantFromSentence(text, money) {
  let result = text;
  const remove = [...money].sort((a, b) => b.start - a.start);
  for (const item of remove) result = result.slice(0, item.start) + ' ' + result.slice(item.end);
  result = result.replace(/20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}日?(?:[ T]+\d{1,2}:\d{2}(?::\d{2})?)?/g, ' ')
    .replace(/大前天|今天|昨天|前天|明天|后天/g, ' ')
    .replace(/微信(?:支付)?|支付宝|人民币|RMB|CNY/gi, ' ')
    .replace(/(?:花了|花费了?|消费了?|支付了?|付款了?|买了?|收到了?|到账了?|收入|退款(?:到账|成功|了)?|退回了?|转账(?:给)?|给|用|在|共计|一共|总计|元|块钱|块)/g, ' ')
    .replace(/^[\s:：,，的]+|[\s:：,，的]+$/g, '');
  return CLEAN(result.replace(/\s+/g, ' ')) || '未识别商户';
}

function queryMonth(text, now) {
  const full = text.match(/(20\d{2})[-/年](\d{1,2})月?/);
  if (full && +full[2] >= 1 && +full[2] <= 12) return `${full[1]}-${pad(+full[2])}`;
  const month = text.match(/(?:^|[^\d])(\d{1,2})月/);
  if (month && +month[1] >= 1 && +month[1] <= 12) return `${now.getFullYear()}-${pad(+month[1])}`;
  const d = new Date(now);
  if (/上个月|上月/.test(text)) d.setMonth(d.getMonth() - 1, 1);
  if (/下个月|下月/.test(text)) d.setMonth(d.getMonth() + 1, 1);
  return localDate(d).slice(0, 7);
}

function splitStatements(text) {
  return text.replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, (s) => s.replace(/,/g, ''))
    .split(/[,，;；\n]+|然后|另外|还有|以及/).map((x) => x.trim()).filter(Boolean);
}

export function parseText(input, opts = {}) {
  const now = getNow(opts); const text = TEXT(input).trim();
  if (!text) return { intent: 'unknown', drafts: [], reply: '可以输入“午饭28，地铁3”，或导入一张付款截图。' };
  if (/^(?:请|帮我)?(?:撤销|撤回)(?:刚才|刚刚|上一笔|上笔|最后一笔|刚记的)?(?:的)?(?:记录|记账)?[。！!\s]*$/.test(text) || /^(?:删除|删掉)上一笔[。！!\s]*$/.test(text)) return { intent: 'undo', drafts: [], reply: '准备撤销上一笔，请核对后执行。' };
  if (/花了?多少|花费多少|支出多少|收入多少|多少钱|查(?:看|询)(?:一下)?(?:账|本月|这个月|上月|支出|收入)|统计|汇总|还剩多少/.test(text)) {
    const explicitMonth = text.match(/(?:20\d{2}年)?(\d{1,2})月/);
    if (explicitMonth && (+explicitMonth[1] < 1 || +explicitMonth[1] > 12)) return { intent: 'unknown', drafts: [], reply: '月份应在1到12之间，请重新输入查询月份。' };
    const category = CATEGORIES.find((x) => x !== '其他' && text.includes(x));
    return { intent: 'query', drafts: [], query: { month: queryMonth(text, now), ...(category ? { category } : {}) }, reply: '按已确认的记录查询整个月。' };
  }
  const edit = text.match(/^(?:请|把)?\s*(?:(?:上一笔|上笔|最后一笔|刚才那笔|刚记的)(?:的)?\s*)?(?:(?:金额|分类)\s*)?(?:改成|改为|修改为|改|换成|调整为)\s*(.+?)[。！!\s]*$/);
  if (edit) {
    const patch = {};
    const category = CATEGORIES.find((x) => edit[1].includes(x));
    if (category) patch.category = category;
    const amounts = moneyCandidates(edit[1]);
    if (amounts.length === 1 && isPositiveCents(amounts[0].cents)) patch.amountCents = amounts[0].cents;
    if (Object.keys(patch).length) return { intent: 'edit', drafts: [], patch, reply: '准备修改上一笔，请核对修改内容。' };
    return { intent: 'unknown', drafts: [], reply: '可以说“上一笔改成26”或“上一笔改交通”。' };
  }
  if (/不要记|别记|不记账|还没(?:买|付)|打算|准备买|计划买|想买|假如|如果|预算|修改|改成|改为|删除|撤销/.test(text)) return { intent: 'unknown', drafts: [], reply: '这段话看起来是计划、查询或修改要求，我先不新增账目。' };
  const statements = splitStatements(text);
  const drafts = []; let skipped = 0; let inherited = '';
  for (const sentence of statements) {
    const info = dateInfo(sentence, now, { inherit: inherited });
    if (info.explicit) inherited = info.date;
    let amounts = moneyCandidates(sentence, info.spans);
    const actual = sentence.match(/(?:实付金额|实际支付|实际付款|实付)\s*[:：]?\s*([¥￥]?\s*[\d,]+(?:\.\d+)?\s*(?:元|块)?)(?![\d.])/);
    if (actual) {
      const cents = parseMoney(actual[1]);
      if (cents !== null) amounts = [{ cents: Math.abs(cents), start: actual.index, end: actual.index + actual[0].length, raw: actual[0] }];
    }
    if (!amounts.length) { skipped++; continue; }
    const incomeStatement = new RegExp(`收入|报销到账|(?:工资|薪水|奖金)(?:到账|发放|发了|到手|\\s*[\\d${CN}])|(?:收到|发了|发放).*(?:工资|薪水|奖金)`).test(sentence);
    let type = /退款|退回|退了/.test(sentence) ? 'refund' : incomeStatement ? 'income' : 'expense';
    const transfer = TRANSFER.test(sentence) || /收到.*转账|转给|收了.*红包/.test(sentence);
    if (transfer) type = 'transfer';
    const knownInternal = /(?:自己|本人|我的).*(?:账户|账号).*转账|(?:账户|账号)之间转账|还信用卡|信用卡还款/.test(sentence);
    const reasons = [];
    if (amounts.length !== 1) reasons.push('存在多个金额，请选择实际发生的金额');
    if (transfer && !knownInternal) reasons.push('转账或借还款用途不明确，请选择消费、收入或内部转账');
    if (info.reason) reasons.push(info.reason);
    if (/退款中|退款申请|申请退款|等待退款/.test(sentence)) reasons.push('退款尚未确认到账');
    if (FAILURE.test(sentence)) reasons.push('交易尚未成功，暂不计入账本统计');
    if (CURRENCY_FOREIGN.test(sentence)) reasons.push('首版只统计人民币，请先核对并换算金额');
    const amountCents = amounts.length === 1 && !CURRENCY_FOREIGN.test(sentence) ? amounts[0].cents : null;
    if (amountCents === 0) reasons.push('零金额需要核对');
    const merchant = merchantFromSentence(sentence, amounts);
    drafts.push(normalizeRecord({ date: info.date, amountCents, type, merchant, category: classify(merchant, sentence, opts.rules), channel: channelOf(sentence), source: 'text', status: reasons.length ? 'pending' : 'confirmed', notes: reasons.join('；') }, { now }));
  }
  if (!drafts.length) return { intent: 'unknown', drafts: [], reply: '没有找到明确的金额。试试“昨天午饭28，地铁3”或“工资到账5000”。' };
  return { intent: 'create', drafts, reply: skipped ? `识别出${drafts.length}笔；另有${skipped}段未找到明确金额，未记账。` : drafts.some((r) => r.status === 'pending') ? '有信息需要核对，待确认记录不会计入统计。' : `整理了${drafts.length}笔，请查看后保存。` };
}

const RECEIPT_FIELDS = [
  '商户名称', '商家名称', '商户全称', '商家全称', '收款商家', '收款单位', '收款方', '付款方', '交易对方', '商户单号', '商家单号', '商户', '商家', '对方',
  '实付金额', '实付款', '实际支付', '实际付款', '实付', '付款金额', '支付金额', '交易金额',
  '退款金额', '已退金额', '退款到账金额', '收款金额', '到账金额', '收入金额',
  '原支付金额', '原付款金额', '商品价格', '账户余额', '余额', '原价', '优惠金额', '优惠', '手续费', '优惠券', '折扣',
  '商品说明', '商品名称', '商品信息', '商品描述', '消费项目', '商品', '备注', '交易单号', '支付单号', '交易号', '退款单号', '退款交易号', '订单号',
  '交易时间', '付款时间', '支付时间', '收款时间', '退款时间', '到账时间', '交易状态', '当前状态', '付款方式', '支付方式', '币种',
].sort((a, b) => b.length - a.length);
const RECEIPT_PHRASES = [...new Set([...RECEIPT_FIELDS,
  '微信支付', '微信', '支付宝', '财付通', '零钱', '花呗', '余额宝',
  '支付成功', '付款成功', '交易成功', '交易完成', '已完成', '已支付', '消费成功',
  '收款成功', '收款到账', '收入到账', '工资到账', '已收款',
  '退款成功', '退款到账', '退款已到账', '已退款', '已退回',
  '支付失败', '付款失败', '交易失败', '交易关闭', '订单关闭', '待支付', '待付款', '等待付款', '未付款', '未支付',
  '退款处理中', '退款申请中', '退款中', '支付已取消', '付款已取消', '订单已取消',
  '账单详情', '交易详情', '付款详情', '支付详情', '收支详情', '消费详情',
])].sort((a, b) => b.length - a.length);

function receiptText(input) {
  let text = TEXT(input).trim();
  // Tesseract often inserts spaces inside Chinese labels. Normalize known
  // phrases only: deleting all Chinese spaces would merge table columns.
  for (const phrase of RECEIPT_PHRASES) text = text.replace(new RegExp([...phrase].join('[ \\t]*'), 'g'), phrase);
  text = text.replace(/(\d)[ \t]*\.[ \t]*(\d)/g, '$1.$2');
  // OCR may flatten several table columns into one line. Preserve each known
  // field separately, instead of storing later fields as part of a merchant.
  return text.replace(new RegExp(`[ \\t]+(?=(?:${RECEIPT_FIELDS.join('|')})(?=\\s|[:：¥￥+\\-\\d]|$))`, 'g'), '\n');
}

function receiptMerchant(value) {
  return CLEAN(value).replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/[〈《<]\s*(?=\()/g, '').replace(/\s*\(\s*/g, '(').replace(/\s*\)/g, ')');
}

const MERCHANT_LABELS = ['商户名称', '商家名称', '商户全称', '商家全称', '收款商家', '收款单位', '收款方', '交易对方', '商户', '商家', '对方'];
const GOODS_LABELS = ['商品说明', '商品名称', '商品信息', '商品描述', '消费项目', '商品', '备注'];

function merchantValues(lines) {
  return [...new Set(fieldValue(lines, MERCHANT_LABELS).map(receiptMerchant).filter(value => !/^(?:实付|支付|交易|付款|退款|收款)(?:金额|时间|单号|成功)|^[¥￥\d]/.test(value)))];
}

function credibleChineseMerchant(value) {
  const text = receiptMerchant(value);
  return text !== '未识别商户' && (text.match(/[\u3400-\u9fff]/g) || []).length >= 2 && text.length <= 70
    && !/^(?:支付|交易|付款|退款|收款|订单)(?:成功|失败|详情|金额|时间|方式|状态|单号)$/.test(text)
    && !/推荐|广告|优惠券|猜你|领取/.test(text);
}

// A merchant crop is intentionally not a complete bill: it can contain just
// the heading. Extract name candidates without requiring payment status/date.
// Only the caller with an already valid whole-image draft may use them.
function croppedMerchantCandidates(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const promotionIndex = lines.findIndex(line => /推荐|广告|领取|优惠券|猜你|更多服务|热门活动|附近好店|每日精选/.test(line));
  const titleLines = promotionIndex < 0 ? lines : lines.slice(0, promotionIndex);
  const labelled = merchantValues(titleLines);
  const candidates = labelled.length ? labelled : titleMerchants(titleLines);
  return [...new Set(candidates.filter(name => {
    if (!credibleChineseMerchant(name)) return false;
    const hasLabel = labelled.includes(name);
    if (!hasLabel && /^(?:小面|拉面|米线|米粉|面馆|咖啡|奶茶|餐饮|购物|交通|超市|便利店|地铁|公交|餐厅|商店)$/.test(name)) return false;
    return hasLabel || classify(name) !== '其他' || /店|馆|公司|商行|商场|商贸|工作室|经营部|合作社/.test(name);
  }))];
}

function receiptGoods(text) {
  return fieldValue(text.split('\n').map(line => line.trim()).filter(Boolean), GOODS_LABELS).join(' ');
}

function fieldValue(lines, labels) {
  const label = new RegExp(`^(?:${labels.join('|')})(?=\\s|[:：¥￥+\\-\\d]|$)\\s*[:：]?\\s*(.*)$`);
  const values = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(label);
    if (!match) continue;
    let value = match[1].trim();
    if (!value) value = (lines[i + 1] || '').trim();
    if (value) values.push(value);
  }
  return values;
}

function receiptAmounts(lines, tiers) {
  for (const labels of tiers) {
    const found = fieldValue(lines, labels);
    if (!found.length) continue;
    const values = found.map((s) => parseMoney(s));
    const unique = [...new Set(values.filter((n) => n !== null).map(Math.abs))];
    return { amount: unique.length === 1 && values.every((n) => n !== null) ? unique[0] : null, ambiguous: unique.length > 1 || values.some((n) => n === null) };
  }
  const values = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!/^[+-]?\s*[¥￥]\s*[\d,.]+(?:\s*元)?$|^[+-]\s*\d+(?:\.\d+)?$|^(?:\d{1,3}(?:,\d{3})+|\d+)\.\d+(?:\s*元)?$/.test(line)) continue;
    if (/余额|原价|优惠|商品价格|手续费|优惠券|折扣|原支付|原付款|金额|交易单号|支付单号|交易号|订单号|商户单号|商家单号/.test(lines[i - 1] || '')) continue;
    const cents = parseMoney(line);
    values.push(cents === null ? null : Math.abs(cents));
  }
  const unique = [...new Set(values.filter(value => value !== null))];
  const ambiguous = unique.length > 1 || values.some(value => value === null);
  return { amount: unique.length === 1 && !ambiguous ? unique[0] : null, ambiguous, unlabelled: unique.length === 1 && !ambiguous };
}

function titleMerchants(lines) {
  const fieldIndex = lines.findIndex(line => new RegExp(`^(?:${RECEIPT_FIELDS.join('|')})(?=\\s|[:：¥￥+\\-\\d]|$)`).test(line));
  const promotionIndex = lines.findIndex(line => /推荐|广告|领取|优惠券|猜你|更多服务|热门活动|附近好店|每日精选/.test(line));
  // The large amount can be above or below the merchant on success pages.
  // Read only the short title region, stopping before details or promotions.
  const end = Math.min(8, fieldIndex < 0 ? 8 : fieldIndex, promotionIndex < 0 ? 8 : promotionIndex);
  const candidates = [...new Set(lines.slice(0, end).map(receiptMerchant).filter(line => {
    const chrome = line.replace(/\s+/g, '').replace(/^[xX×<>‹›〈〉←→|·.]+|[xX×<>‹›〈〉←→|·.]+$/g, '');
    if (/^(?:账单|全部账单|账单详情|交易详情|付款详情|支付详情)+$/.test(chrome)) return false;
    if (!line || line.length > 70 || /[:：¥￥]/.test(line) || /^[-+\d.,%\s]+$/.test(line)) return false;
    if (COMPLETE.test(line) || INCOME.test(line) || REFUND.test(line) || FAILURE.test(line)) return false;
    if (/^[\u3400-\u9fff]{1,8}(?:成功|失败|完成)$/.test(line)) return false;
    if (/^(?:微信(?:支付)?|支付宝|账单详情|交易详情|付款详情|支付详情|收支详情|消费详情|支出|收入|退款|完成|返回|详情|付款|收款|金额|元|圆|人民币|交易记录|中国移动|中国联通|中国电信)$/.test(line)) return false;
    if (/余额|优惠|推荐|广告|领取|小程序|服务|单号|20\d{2}[-/年]\d|^[\d.]+(?:KB|MB|%)/i.test(line)) return false;
    return /[\u3400-\u9fffA-Za-z]/.test(line);
  }))];
  // A logo/category word can repeat the noun in the complete store heading.
  // Do not count that substring as a second store; distinct full names remain.
  const hasChineseStore = candidates.some(name => credibleChineseMerchant(name) && (classify(name) !== '其他' || /店|馆|公司|商行|商场|商贸|工作室|经营部|合作社/.test(name)));
  return candidates.filter(name => !(hasChineseStore && /^[A-Za-z]{1,3}$/.test(name) && !/^KFC$/i.test(name)))
    .filter(name => !/^(?:小面|拉面|米线|米粉|面馆|咖啡|奶茶|餐饮|购物|交通|超市|便利店|地铁|公交|餐厅|商店)$/.test(name)
      || !candidates.some(other => other !== name && other.includes(name) && credibleChineseMerchant(other)));
}

/** The input is Apple/browser OCR output, not an image. Raw OCR is never put in a record. */
export function parseReceipt(input, opts = {}) {
  const now = getNow(opts); const text = receiptText(input);
  if (!text) return { drafts: [], ignored: true, reason: '没有识别出文字，请选择清晰的付款成功截图。' };
  if (FAILURE.test(text) || /未支付|支付已取消|付款已取消|订单已取消/.test(text)) return { drafts: [], ignored: true, reason: '截图显示交易失败、待付款或退款未到账，未新增账目。' };
  const expense = COMPLETE.test(text); const income = INCOME.test(text); const refund = REFUND.test(text); const transfer = TRANSFER.test(text);
  const lines = text.split('\n').map((x) => x.trim()).filter(Boolean);
  // A clear bill-detail header plus an explicit payment timestamp can still
  // produce a review draft when stylised status glyphs are unreadable. This
  // never asserts completion; unpaid/failed states were rejected above.
  const detailContext = /账单详情|交易详情|付款详情|支付详情/.test(text) && fieldValue(lines, ['付款时间', '支付时间', '交易时间']).some(value => { const info = dateInfo(value, now, {ocr:true}); return info.explicit && !info.reason && info.date.includes('T'); });
  if (!expense && !income && !refund && !transfer && !detailContext && !/实付金额|实付|支付金额|付款金额|退款金额|收款金额/.test(text)) return { drafts: [], ignored: true, reason: '没有找到交易完成信息，请使用单笔付款成功页或账单详情。' };
  let type = refund ? 'refund' : income ? 'income' : transfer ? 'transfer' : 'expense';
  const reasons = [];
  if (transfer) { type = 'transfer'; reasons.push('请核对这是消费、收入还是自己账户之间的转账'); }
  if (expense && income && !refund) reasons.push('同时出现付款和收款信息，请核对收支方向');
  if (!expense && !income && !refund && !transfer) reasons.push('未读清交易完成状态，请确认这笔已实际付款，再核对收支类型');
  const tiers = refund ? [['退款金额', '已退金额', '退款到账金额']] : income ? [['收款金额', '到账金额', '收入金额']] : [['实付金额', '实付款', '实际支付', '实际付款', '实付'], ['付款金额', '支付金额'], ['交易金额']];
  const amount = receiptAmounts(lines, tiers);
  if (amount.ambiguous) reasons.push('找到多个金额或金额格式不明确，请核对实付金额');
  if (amount.unlabelled) reasons.push('金额来自未标注的独立数字，请核对实际交易金额');
  if (amount.amount === null) reasons.push('未找到唯一有效的实际交易金额');
  if (amount.amount === 0) reasons.push('零金额需要核对');
  if (CURRENCY_FOREIGN.test(text)) reasons.push('首版只统计人民币，请先核对并换算金额');
  const merchants = merchantValues(lines);
  let merchant = merchants.length === 1 ? merchants[0] : '未识别商户';
  if (merchants.length > 1) reasons.push('截图包含多个商户，请核对');
  if (!merchants.length) {
    const titles = titleMerchants(lines);
    if (titles.length === 1) { merchant = titles[0]; reasons.push('商户来自截图标题，请核对'); }
    else if (titles.length > 1) reasons.push('截图标题中有多个可能的商户，请核对');
  }
  if (merchant === '未识别商户') reasons.push('未找到明确的商户或用途，请补全');
  const goods = fieldValue(lines, GOODS_LABELS).join(' ');
  const channel = channelOf(text);
  const idLabels = refund ? ['退款单号', '退款交易号'] : ['交易单号', '支付单号', '交易号'];
  const ids = [...new Set(fieldValue(lines, idLabels).filter((s) => /^[A-Za-z0-9_-]{8,100}$/.test(s)))];
  if (ids.length > 1) reasons.push('截图包含多个交易单号，请使用单笔账单');
  const completeCount = (text.match(/支付成功|付款成功|交易成功|收款成功|退款成功/g) || []).length;
  if (completeCount > 1 && !refund && !income) reasons.push('截图可能包含多笔交易，请逐笔核对');
  const dateLabels = refund ? ['退款时间', '到账时间', '交易时间'] : ['交易时间', '付款时间', '支付时间', '收款时间'];
  const labelledDates = fieldValue(lines, dateLabels);
  const info = dateInfo(labelledDates.length === 1 ? labelledDates[0] : text, now, { ocr: true });
  if (info.reason) reasons.push(info.reason);
  if (info.estimated) reasons.push('截图未提供完整日期，暂按采集时间，请核对');
  const uniqueReasons = [...new Set(reasons)];
  const draft = normalizeRecord({ date: info.date, amountCents: CURRENCY_FOREIGN.test(text) ? null : amount.amount, type, merchant, category: classify(merchant, goods, opts.rules), channel, source: 'ocr', sourceId: ids.length === 1 ? ids[0] : '', notes: uniqueReasons.join('；'), status: uniqueReasons.length ? 'pending' : 'confirmed' }, { now });
  return { drafts: [draft], suggestions: [inferReceiptContext(draft, { goods, rules: opts.rules, explicitTime: !info.estimated && !info.reason })], ...(uniqueReasons.length ? { reason: uniqueReasons.join('；') } : {}) };
}

const RECEIPT_STATE = /支付成功|付款成功|交易成功|交易完成|已完成|已支付|消费成功|收款成功|收款到账|收入到账|工资到账|已收款|退款成功|退款到账|退款已到账|已退款|已退回|转账成功/g;
const receiptFailed = text => FAILURE.test(text) || /未支付|支付已取消|付款已取消|订单已取消/.test(text);

function readingText(value) {
  let joinedDigits = false;
  const text = receiptText(value).split('\n').map(line => {
    // Sparse OCR can separate large glyphs: "1 8.00". Join only a whole
    // decimal-money line, never separate integers or a line of several values.
    const match = line.trim().match(/^([+-]?\s*[¥￥]?\s*)(\d[\d \t]*)(\.\d{1,2})(\s*元)?$/);
    if (!match || !/\d[ \t]+\d/.test(match[2])) return line;
    joinedDigits = true;
    return match[1] + match[2].replace(/[ \t]/g, '') + match[3] + (match[4] || '');
  }).join('\n');
  return { text, joinedDigits, states: [...new Set(text.match(RECEIPT_STATE) || [])] };
}

/** Combine complementary local OCR passes of the same image conservatively.
 * Alternate readings can supply a missing amount, a clear Chinese merchant or
 * a genuinely observed status. Conflicts never resolve through confidence.
 * Raw readings and suggestion explanations never become record fields.
 */
export function parseReceiptReadings(readings, opts = {}) {
  if (!Array.isArray(readings) || !readings.length) return parseReceipt('', opts);
  if (readings[0]?.role === 'merchant') return { drafts: [], ignored: true, reason: '缺少完整截图的交易信息，请重新选择完整账单。' };
  const items = readings.map(reading => readingText(reading?.text ?? ''));
  const wholeItems = items.filter((_, index) => readings[index]?.role !== 'merchant');
  if (wholeItems.some(item => receiptFailed(item.text))) return { drafts: [], ignored: true, reason: '截图的一次识别显示交易失败、待付款或退款未到账，未新增账目。' };
  const states = [...new Set(wholeItems.flatMap(item => item.states))];
  const parsed = items.map(item => parseReceipt(item.states.length || !states.length ? item.text : `${item.text}\n${states.join('\n')}`, opts));
  const base = parsed[0].drafts[0];
  if (!base) return parsed[0];
  const notes = base.notes ? base.notes.split(/[;；]/).filter(Boolean) : [];
  const addNote = note => { const value = CLEAN(note, 500); if (!notes.includes(value)) notes.push(value); };
  const foreign = wholeItems.some(item => CURRENCY_FOREIGN.test(item.text));
  // A cropped merchant-only reading may cut the amount in half. Its role only
  // limits the fields considered; it never grants a reading extra trust.
  const monetaryReadings = parsed.filter((_, index) => readings[index]?.role !== 'merchant');
  const amounts = [...new Set(monetaryReadings.flatMap(result => result.drafts).map(draft => draft.amountCents).filter(value => Number.isSafeInteger(value) && value >= 0))];
  const ambiguous = monetaryReadings.some(result => result.drafts.some(draft => /找到多个金额或金额格式不明确/.test(draft.notes)));
  let merchant = base.merchant;
  const primaryLines = items[0].text.split('\n').map(line => line.trim()).filter(Boolean);
  const primaryLabelled = merchantValues(primaryLines).includes(merchant);
  const primaryAmbiguous = /截图包含多个商户|多个可能的商户/.test(base.notes);
  const alternateMerchants = [...new Set(parsed.slice(1).flatMap((result, offset) => {
    const index = offset + 1;
    if (readings[index]?.role === 'merchant') return croppedMerchantCandidates(items[index].text);
    return result.drafts.filter(draft => {
      if (!credibleChineseMerchant(draft.merchant)) return false;
      const labelled = merchantValues(items[index].text.split('\n').map(line => line.trim()).filter(Boolean)).includes(draft.merchant);
      return labelled || classify(draft.merchant) !== '其他' || /店|馆|公司|商行|商场|商贸|工作室|经营部|合作社/.test(draft.merchant);
    }).map(draft => draft.merchant);
  }))];
  if (!primaryAmbiguous && (merchant === '未识别商户' || (!primaryLabelled && !credibleChineseMerchant(merchant) && !/^(?:Apple|IKEA|MUJI|UNIQLO|Starbucks|Luckin|KFC|McDonald|Nike|Adidas)\b/i.test(merchant)))) {
    if (alternateMerchants.length === 1) {
      merchant = alternateMerchants[0];
      for (let index = notes.length - 1; index >= 0; index--) if (/未找到明确的商户或用途/.test(notes[index])) notes.splice(index, 1);
      addNote('商户由补充识别读取，请对照截图核对');
    } else if (alternateMerchants.length > 1) {
      merchant = '未识别商户';
      addNote('补充识别包含多个不同商户，请对照截图填写');
    }
  } else if (credibleChineseMerchant(merchant) && alternateMerchants.some(value => value !== merchant)) {
    const labelledConflict = items.slice(1).some(item => merchantValues(item.text.split('\n').map(line => line.trim()).filter(Boolean)).some(value => value !== merchant && alternateMerchants.includes(value)));
    if (primaryLabelled && !labelledConflict) {
      // An explicit merchant field outranks an unlabelled, possibly clipped
      // heading. Preserve that candidate for review instead of erasing it.
      addNote('补充读取的店名不一致，暂保留明确商户名称，请核对');
    } else {
      merchant = '未识别商户';
      addNote('不同识别结果的商户不一致，请对照截图填写');
    }
  }
  let amountCents = base.amountCents;
  if (foreign) {
    amountCents = null;
    addNote('识别结果包含外币信息，首版只统计人民币，请先核对并换算金额');
  } else if (ambiguous || amounts.length > 1) {
    amountCents = null;
    addNote(amounts.length > 1 ? '不同识别结果的金额不一致，请对照截图填写' : '识别结果中有多个金额或格式不明确，补充识别不能替你确定金额');
  } else if (amountCents === null && amounts.length === 1) {
    amountCents = amounts[0];
    const missing = notes.indexOf('未找到唯一有效的实际交易金额');
    if (missing >= 0) notes.splice(missing, 1);
    addNote('金额由补充识别读取，请对照截图核对');
  }
  if (!items[0].states.length && states.length) addNote('交易状态由补充识别读取，请核对交易是否完成');
  if (wholeItems.some(item => item.joinedDigits)) addNote('金额数字中的空格已合并，请对照截图核对');
  if (new Set(monetaryReadings.flatMap(result => result.drafts).map(draft => draft.type)).size > 1) addNote('不同识别结果的收支方向不一致，请核对');
  const primaryGoods = receiptGoods(items[0].text);
  const alternateGoods = [...new Set(items.slice(1).map(item => receiptGoods(item.text)).filter(Boolean))];
  const goods = primaryGoods || (alternateGoods.length === 1 ? alternateGoods[0] : '');
  let category = classify(merchant, goods, opts.rules);
  let categoryBasis = '';
  // Name identity and spending category have different certainty. Several
  // trustworthy readings may disagree on a name while all indicate dining.
  // Keep the unresolved identity, but do not throw away that shared evidence.
  if (merchant === '未识别商户' && category === '其他') {
    const primaryCandidates = primaryAmbiguous ? (merchantValues(primaryLines).length ? merchantValues(primaryLines) : titleMerchants(primaryLines)) : [base.merchant];
    const primaryLabels = merchantValues(primaryLines);
    const primaryNames = primaryCandidates.filter(name => credibleChineseMerchant(name) && (primaryLabels.includes(name) || classify(name) !== '其他' || /店|馆|公司|商行|商场|商贸|工作室|经营部|合作社/.test(name)));
    const credibleNames = [...new Set([...primaryNames, ...alternateMerchants].filter(credibleChineseMerchant))];
    const candidateCategories = [...new Set(credibleNames.map(name => classify(name, '', opts.rules)))];
    if (credibleNames.length && candidateCategories.length === 1 && candidateCategories[0] !== '其他') {
      category = candidateCategories[0];
      categoryBasis = `店名尚未读清，但可信店名线索的分类一致，建议${category}；请补全店名`;
      addNote(`店名尚需核对，已有一致线索建议分类为${category}`);
    }
  }
  const draft = normalizeRecord({ ...base, merchant, category, amountCents, notes: notes.join('；'), status: notes.length ? 'pending' : base.status }, opts);
  const suggestion = inferReceiptContext(draft, { goods, rules: opts.rules });
  if (categoryBasis) suggestion.basis[0] = categoryBasis;
  return { drafts: [draft], suggestions: [suggestion], ...(notes.length ? { reason: notes.join('；') } : {}) };
}

export function findDuplicate(candidate, records = []) {
  if (!candidate || !Array.isArray(records)) return { level: 'none' };
  const sourceId = CLEAN(candidate.sourceId);
  for (const record of records) {
    if (!record) continue;
    if (candidate.id && candidate.id === record.id) return { level: 'exact', record, reason: '已有相同记录编号' };
    if (sourceId && sourceId === CLEAN(record.sourceId) && candidate.channel === record.channel && candidate.type === record.type) {
      if (candidate.channel !== '其他' && candidate.amountCents === record.amountCents) return { level: 'exact', record, reason: '支付渠道、交易单号、收支类型和金额相同' };
      return { level: 'possible', record, reason: candidate.amountCents !== record.amountCents ? '交易单号相同但金额不同，请核对' : '交易单号相同，支付渠道尚不明确' };
    }
  }
  if (!isPositiveCents(candidate.amountCents)) return { level: 'none' };
  const possible = records.find((r) => r && !(sourceId && CLEAN(r.sourceId) && sourceId !== CLEAN(r.sourceId)) && isPositiveCents(r.amountCents) && r.amountCents === candidate.amountCents && r.type === candidate.type && CLEAN(r.merchant).toLocaleLowerCase() === CLEAN(candidate.merchant).toLocaleLowerCase() && candidate.merchant !== '未识别商户' && validDate(r.date) && validDate(candidate.date) && r.date.slice(0, 10) === candidate.date.slice(0, 10));
  return possible ? { level: 'possible', record: possible, reason: '同一天存在相同商户、金额和类型的记录，可能是另一笔真实消费' } : { level: 'none' };
}

export function summarize(records = [], month) {
  const result = { expenseCents: 0, refundCents: 0, netExpenseCents: 0, incomeCents: 0, byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, 0])), count: 0 };
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month || '')) return result;
  const add = (a, b) => { const n = a + b; if (!Number.isSafeInteger(n)) throw new RangeError('金额合计超出可安全计算范围'); return n; };
  for (const record of records) {
    if (!record || record.status !== 'confirmed' || !validDate(record.date) || record.date.slice(0, 7) !== month || !isPositiveCents(record.amountCents) || !TYPES.has(record.type)) continue;
    result.count++;
    const category = CATEGORIES.includes(record.category) ? record.category : '其他';
    if (record.type === 'expense') { result.expenseCents = add(result.expenseCents, record.amountCents); result.byCategory[category] = add(result.byCategory[category], record.amountCents); }
    if (record.type === 'refund') { result.refundCents = add(result.refundCents, record.amountCents); result.byCategory[category] = add(result.byCategory[category], -record.amountCents); }
    if (record.type === 'income') result.incomeCents = add(result.incomeCents, record.amountCents);
  }
  result.netExpenseCents = add(result.expenseCents, -result.refundCents);
  return result;
}
