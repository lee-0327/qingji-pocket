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
  ['餐饮', /餐饮|午饭|午餐|晚饭|晚餐|早饭|早餐|夜宵|吃饭|外卖|餐厅|饭店|面馆|咖啡|奶茶|瑞幸|星巴克|肯德基|麦当劳|买菜|水果/],
  ['交通', /交通|地铁|公交|高铁|铁路|火车|机票|飞机票|滴滴|打车|出租车|停车|通行费|加油|车费/],
  ['购物', /购物|衣服|衣裤|服装|鞋子|鞋店|数码|手机|电器|家具|电脑|文具/],
  ['住房', /住房|房租|物业|水费|电费|燃气|供暖|房贷/],
  ['日用', /日用|超市|便利店|纸巾|洗衣液|洗发水|洗衣|百货/],
  ['健康', /健康|医院|药店|药房|挂号|诊疗|体检|看病|牙科|买药/],
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
  const key = CLEAN(merchant).toLocaleLowerCase();
  for (const [name, category] of Object.entries(rules || {})) {
    if (CATEGORIES.includes(category) && CLEAN(name).toLocaleLowerCase() === key && key && key !== '未识别商户') return category;
  }
  for (const source of [CLEAN(merchant), CLEAN(text, 1000)]) {
    const found = KEYWORDS.find(([, pattern]) => pattern.test(source));
    if (found) return found[0];
  }
  return '其他';
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
    if (!/^[+-]?\s*[¥￥]\s*[\d,.]+(?:\s*元)?$|^[+-]\s*\d+(?:\.\d+)?$/.test(line)) continue;
    if (/余额|原价|优惠|商品价格|手续费|优惠券|折扣|原支付/.test(lines[i - 1] || '')) continue;
    const cents = parseMoney(line);
    if (cents !== null) values.push(Math.abs(cents));
  }
  const unique = [...new Set(values)];
  return { amount: unique.length === 1 ? unique[0] : null, ambiguous: unique.length > 1 };
}

/** The input is Apple/browser OCR output, not an image. Raw OCR is never put in a record. */
export function parseReceipt(input, opts = {}) {
  const now = getNow(opts); const text = TEXT(input).trim();
  if (!text) return { drafts: [], ignored: true, reason: '没有识别出文字，请选择清晰的付款成功截图。' };
  if (FAILURE.test(text)) return { drafts: [], ignored: true, reason: '截图显示交易失败、待付款或退款未到账，未新增账目。' };
  const expense = COMPLETE.test(text); const income = INCOME.test(text); const refund = REFUND.test(text); const transfer = TRANSFER.test(text);
  if (!expense && !income && !refund && !transfer && !/实付金额|实付|支付金额|付款金额|退款金额|收款金额/.test(text)) return { drafts: [], ignored: true, reason: '没有找到交易完成信息，请使用单笔付款成功页或账单详情。' };
  let type = refund ? 'refund' : income ? 'income' : transfer ? 'transfer' : 'expense';
  const reasons = [];
  if (transfer) { type = 'transfer'; reasons.push('请核对这是消费、收入还是自己账户之间的转账'); }
  if (expense && income && !refund) reasons.push('同时出现付款和收款信息，请核对收支方向');
  if (!expense && !income && !refund && !transfer) reasons.push('未识别到明确的交易完成状态');
  const lines = text.split('\n').map((x) => x.trim()).filter(Boolean);
  const tiers = refund ? [['退款金额', '已退金额', '退款到账金额']] : income ? [['收款金额', '到账金额', '收入金额']] : [['实付金额', '实付款', '实际支付', '实际付款', '实付'], ['付款金额', '支付金额'], ['交易金额']];
  const amount = receiptAmounts(lines, tiers);
  if (amount.ambiguous) reasons.push('找到多个金额或金额格式不明确，请核对实付金额');
  if (amount.amount === null) reasons.push('未找到唯一有效的实际交易金额');
  if (amount.amount === 0) reasons.push('零金额需要核对');
  if (CURRENCY_FOREIGN.test(text)) reasons.push('首版只统计人民币，请先核对并换算金额');
  const merchantValues = [...new Set(fieldValue(lines, ['商户名称', '商家名称', '收款商家', '收款方', '商户', '商家', '对方']).map((s) => CLEAN(s)).filter((s) => !/^(?:实付|支付|交易|付款|退款|收款)(?:金额|时间|单号|成功)|^[¥￥\d]/.test(s)))];
  let merchant = merchantValues.length === 1 ? merchantValues[0] : '未识别商户';
  if (merchantValues.length > 1) reasons.push('截图包含多个商户，请核对');
  if (merchant === '未识别商户') {
    const known = lines.slice(0, 6).find((line) => /^(?:瑞幸|星巴克|肯德基|麦当劳|滴滴|地铁|公交)[^:：]{0,70}$/.test(line));
    if (known) merchant = CLEAN(known);
  }
  const goods = fieldValue(lines, ['商品说明', '商品名称', '商品', '备注']).join(' ');
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
  return { drafts: [draft], ...(uniqueReasons.length ? { reason: uniqueReasons.join('；') } : {}) };
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
