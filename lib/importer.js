/**
 * Qingji Pocket bill-file parser. Original implementation, no network or eval.
 * Parses local CSV/TSV text and rows already decoded by the XLSX reader.
 * All amounts are positive integer fen. Uncertain transaction meaning is
 * retained as a pending draft with an explanation, never silently guessed.
 * Strings remain data; consumers must render them with textContent and escape
 * formula-like text if exporting CSV for spreadsheet applications.
 */

import {CATEGORIES, classify} from './core.js';

const EMPTY = new Set(['', '-', '--', '/', '—', '无', 'null', 'undefined', 'n/a']);

const aliases = {
  date: ['交易时间', '交易日期', '日期', '记账时间', '记账日期', '账单时间', '付款时间', '收款时间', '交易创建时间', '时间', 'date', 'datetime', 'transactiondate', 'transactiontime', 'timestamp', 'paidat'],
  amount: ['金额', '金额元', '金额人民币', '金额cny', '交易金额', '交易金额元', '变动金额', '收支金额', '付款金额', '实付金额', 'amount', 'transactionamount', 'value'],
  expenseAmount: ['支出金额', '支出元', 'expenseamount', 'debit'],
  incomeAmount: ['收入金额', '收入元', 'incomeamount', 'credit'],
  refundAmount: ['退款金额', '退款金额元', '成功退款元', '成功退款', '已退金额', 'refundamount'],
  direction: ['收支', '收支类型', '收支方向', '收入支出', '性质', '交易性质', '类型', 'direction', 'type', 'incomeexpense'],
  businessType: ['交易类型', '业务类型', '业务名称', 'transactiontype', 'biztype'],
  merchant: ['交易对方', '对方', '收款方', '付款方', '交易商户', '商户', '商户名称', '商家', '商家名称', 'merchant', 'payee', 'counterparty', 'vendor', 'name'],
  goods: ['商品', '商品名称', '商品说明', '交易说明', '标题', '摘要', 'description', 'item'],
  category: ['分类', '类别', '消费分类', '交易分类', 'category', 'cate'],
  channel: ['渠道', '来源', '平台', '支付平台', 'channel', 'platform'],
  paymentMethod: ['支付方式', '收付款方式', '付款方式', '支付工具', 'paymentmethod'],
  status: ['当前状态', '交易状态', '状态', 'status', 'state'],
  sourceId: ['交易单号', '交易号', '账单号', '交易订单号', '订单号', '流水号', '交易流水号', 'sourceid', 'transactionid', 'orderid', 'id'],
  refundId: ['退款单号', '退款订单号', '退款流水号', 'refundid'],
  merchantOrderId: ['商户单号', '商家订单号', '商户订单号', 'merchantorderid'],
  originalId: ['原交易单号', '原交易号', '原订单号', 'originalid'],
  notes: ['备注', '说明', '附言', 'notes', 'note', 'memo'],
  currency: ['币种', '货币', '货币类型', 'currency', 'currencycode'],
};

const normalizeHeader = value => String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase()
  .replace(/[\s()（）\[\]【】_/\\:：-]/g, '');
const aliasIndex = new Map(Object.entries(aliases).flatMap(([field, labels]) => labels.map((label, rank) => [normalizeHeader(label), {field, rank}])));
const text = value => value == null ? '' : String(value).replace(/^\uFEFF/, '').trim();
const missing = value => EMPTY.has(text(value).toLowerCase());
const pad = number => String(number).padStart(2, '0');

function headerMap(row) {
  const map = Object.create(null);
  const ranks = Object.create(null);
  row.forEach((label, index) => {
    const entry = aliasIndex.get(normalizeHeader(label));
    if (entry && (map[entry.field] === undefined || entry.rank < ranks[entry.field])) {
      map[entry.field] = index;
      ranks[entry.field] = entry.rank;
    }
  });
  // Old Alipay exports contain both “类型” (business type) and “收/支”.
  if (map.businessType === undefined && map.direction !== undefined) {
    const businessIndex = row.findIndex((label, index) => index !== map.direction && ['类型', 'type'].includes(normalizeHeader(label)));
    if (businessIndex >= 0) map.businessType = businessIndex;
  }
  return map;
}

function findHeader(rows) {
  let best = null;
  for (let index = 0; index < Math.min(rows.length, 150); index++) {
    if (!Array.isArray(rows[index])) continue;
    const map = headerMap(rows[index]);
    const hasMoney = map.amount !== undefined || map.expenseAmount !== undefined || map.incomeAmount !== undefined || map.refundAmount !== undefined;
    if (map.date === undefined || !hasMoney) continue;
    const score = 6 + ['merchant', 'direction', 'businessType', 'status', 'sourceId', 'goods'].reduce((n, key) => n + (map[key] === undefined ? 0 : 1), 0);
    if (!best || score > best.score) best = {index, map, score};
  }
  return best;
}

/** RFC4180-style parser: quoted newlines and doubled quotes are preserved. */
function splitDelimited(input, delimiter) {
  const rows = [], rowNumbers = [], malformed = new Set();
  let row = [], field = '', quoted = false, justClosed = false, line = 1, rowStart = 1;
  const pushField = () => { row.push(field); field = ''; justClosed = false; };
  const pushRow = () => { pushField(); rows.push(row); rowNumbers.push(rowStart); row = []; rowStart = line + 1; };
  const source = String(input ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let index = 0; index < source.length; index++) {
    const ch = source[index];
    if (quoted) {
      if (ch === '"') {
        if (source[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; justClosed = true; }
      } else { field += ch; if (ch === '\n') line++; }
    } else if (ch === delimiter) pushField();
    else if (ch === '\n') { pushRow(); line++; }
    else if (ch === '"' && field.trim() === '') { field = ''; quoted = true; }
    else {
      if (justClosed && ch.trim() !== '') malformed.add(rowStart);
      field += ch;
    }
  }
  if (quoted) malformed.add(rowStart);
  if (field !== '' || row.length) { pushField(); rows.push(row); rowNumbers.push(rowStart); }
  return {rows, rowNumbers, malformed};
}

function detectFormat(rows, header, filename) {
  const labels = rows[header.index].map(normalizeHeader);
  const preamble = rows.slice(0, header.index).flat().join(' ');
  const hint = `${filename || ''} ${preamble}`;
  if (labels.includes('当前状态') && labels.includes('交易类型')) return 'wechat';
  if (labels.includes('商品说明') && (labels.includes('收付款方式') || labels.includes('交易订单号') || labels.includes('交易分类'))) return 'alipay';
  if (labels.includes('交易创建时间') && labels.includes('成功退款元') && (labels.includes('资金状态') || labels.includes('交易来源地'))) return 'alipay';
  if (/微信|wechat/i.test(hint) && !/支付宝|alipay/i.test(hint)) return 'wechat';
  if (/支付宝|alipay/i.test(hint) && !/微信|wechat/i.test(hint)) return 'alipay';
  return 'generic';
}

function money(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return {error: '金额不是有限数值'};
    const cents = Math.round(Math.abs(value) * 100);
    if (!Number.isSafeInteger(cents)) return {error: '金额超出可安全计算范围'};
    if (Math.abs(Math.abs(value) * 100 - cents) > 0.000001) return {error: '金额超过两位小数，未自动截断'};
    return {cents, negative: value < 0};
  }
  const original = text(value);
  if (missing(original)) return {error: '金额缺失'};
  if (/^[=+@]/.test(original) && !/^\+\s*[¥￥]?\s*\d/.test(original)) return {error: '金额是公式或不支持的表达式'};
  let clean = original.replace(/^(?:CNY|RMB|人民币)\s*/i, '').replace(/\s*(?:CNY|RMB|人民币|元)$/i, '').trim();
  clean = clean.replace(/^[¥￥]\s*/, '').trim();
  let negative = false;
  if (/^\(.*\)$/.test(clean)) {
    negative = true;
    clean = clean.slice(1, -1).trim();
    if (/^[+−-]/.test(clean)) return {error: '金额格式包含重复正负号'};
  }
  if (/^[-−]/.test(clean)) { negative = true; clean = clean.slice(1).trim(); }
  else if (/^\+/.test(clean)) clean = clean.slice(1).trim();
  clean = clean.replace(/^[¥￥]\s*/, '').trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(clean)) return {error: '金额格式无效或不是人民币金额，未自动截断'};
  const [integer, fractional = ''] = clean.replaceAll(',', '').split('.');
  // String arithmetic avoids turning a long number into a rounded floating value.
  const significantInteger = integer.replace(/^0+/, '') || '0';
  if (significantInteger.length > 14) return {error: '金额超出可安全计算范围'};
  const centsBig = BigInt(significantInteger) * 100n + BigInt(fractional.padEnd(2, '0'));
  if (centsBig > BigInt(Number.MAX_SAFE_INTEGER)) return {error: '金额超出可安全计算范围'};
  return {cents: Number(centsBig), negative};
}

function validDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false;
  const days = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function dateValue(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return {error: '日期无效'};
    return {date: value.toISOString().slice(0, 19), warning: '电子表格日期对象按其日历值读取，请核对时区'};
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value >= 2958466 || Math.floor(value) === 60) return {error: 'Excel 日期序号无效'};
    const days = Math.floor(value) - (value >= 60 ? 1 : 0);
    const seconds = Math.round((value - Math.floor(value)) * 86400);
    const converted = new Date(Date.UTC(1899, 11, 31) + days * 86400000 + seconds * 1000);
    return {date: converted.toISOString().slice(0, 19)};
  }
  let source = text(value).replace(/^'/, '').trim();
  if (!source) return {error: '交易日期缺失'};
  const match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/i.exec(source);
  if (!match) return {error: '日期格式无法识别，需使用完整年月日'};
  const [, ys, ms, ds, hs, mins, ss, fraction, zone] = match;
  const year = Number(ys), month = Number(ms), day = Number(ds), hour = Number(hs || 0), minute = Number(mins || 0), second = Number(ss || 0);
  if (!validDateParts(year, month, day, hour, minute, second)) return {error: '日期或时间超出有效范围'};
  if (fraction && !hs) return {error: '日期格式无效'};
  const base = `${ys}-${pad(month)}-${pad(day)}`;
  const date = hs === undefined ? base : `${base}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
  return {date, ...(zone ? {warning: '日期带有时区，暂保留原日历时间，请核对后确认'} : {})};
}

function categoryFor(merchant, goods, original, rules) {
  const normalizedMerchant = text(merchant).normalize('NFKC').toLocaleLowerCase();
  const hasRule = rules && typeof rules === 'object' && !Array.isArray(rules) && Object.entries(rules)
    .some(([name, category]) => CATEGORIES.includes(category) && text(name).normalize('NFKC').toLocaleLowerCase() === normalizedMerchant);
  if (hasRule) return classify(merchant, goods, rules);
  if (CATEGORIES.includes(text(original))) return text(original);
  return classify(merchant, goods, rules);
}

function channelFor(raw, format) {
  if (format === 'wechat') return '微信';
  if (format === 'alipay') return '支付宝';
  if (/微信|财付通|wechat/i.test(raw)) return '微信';
  if (/支付宝|alipay/i.test(raw)) return '支付宝';
  return '其他';
}

function classifyType(direction, businessType, status, amountInfo) {
  const nature = `${direction} ${businessType}`.trim();
  const lower = text(direction).toLowerCase();
  if (/不计(?:入)?收支|不计收.?支|内部转账|本人转账|账户间转账|资金划转|信用卡还款|还信用卡/i.test(nature) || lower === 'transfer' || lower === '转账') return {type: 'transfer'};
  if (/^(?:退款|退货退款|refund)$/i.test(text(direction)) || /退款|退货退款|商户退费|退款入账/i.test(businessType)) return {type: 'refund'};
  // Status can describe a previous payment rather than an independent refund.
  if (/退款成功|退款完成|退款入账|退款到账|已(?:全额|部分)?退款|已退回|refunded/i.test(status) && /收入|income|credit/i.test(direction)) return {type: 'refund'};
  if (/转账|提现|还款|充值|理财申购|理财赎回/i.test(nature)) return {type: 'transfer', warning: '转账、充值或还款用途需核对，未自动当作消费或收入'};
  if (/^(?:收入|收|入账|income|credit|in)$/i.test(text(direction))) return {type: 'income', ...(amountInfo.negative ? {warning: '收支标记为收入，但金额带负号，请核对'} : {})};
  if (/^(?:支出|支|消费|付款|expense|debit|out)$/i.test(text(direction))) return {type: 'expense'};
  if (/退款成功|退款完成|退款入账|退款到账|已(?:全额|部分)?退款|已退回|refunded/i.test(status)) return {type: 'refund', warning: '退款状态缺少明确收支方向，请核对是否独立退款流水'};
  if (/商户消费|消费|付款|购物|手续费/.test(businessType)) return {type: 'expense'};
  if (/工资|薪资|利息收入|商户收款|收款/.test(businessType)) return {type: 'income'};
  if (amountInfo.negative) return {type: 'expense', warning: '根据金额负号暂记为支出，请核对交易性质'};
  return {type: 'expense', warning: '缺少明确收支方向，请选择消费、收入、退款或内部转账'};
}

function readIdentifier(row, map, key) {
  if (map[key] === undefined) return {value: ''};
  const raw = row[map[key]];
  if (typeof raw === 'number' && !Number.isSafeInteger(raw)) return {value: '', warning: '交易号已被表格转换为不精确数字，无法可靠去重'};
  const value = text(raw).replace(/^'/, '').trim();
  return {value: missing(value) ? '' : value};
}

function parseRowsInternal(rows, options, metadata = {}) {
  const warnings = [], skipped = [], drafts = [];
  const result = {format: 'generic', drafts, skipped, warnings, headers: []};
  if (!Array.isArray(rows)) { warnings.push('账单内容必须是行数组'); return result; }
  const header = findHeader(rows);
  if (!header) { warnings.push('没有找到同时包含日期和金额的表头，请使用微信/支付宝原始账单或标准 CSV'); return result; }
  const map = header.map;
  result.headers = rows[header.index].map(text);
  result.format = detectFormat(rows, header, options.filename);
  if (header.index) warnings.push(`已跳过表头前 ${header.index} 行说明`);
  const physicalRow = index => metadata.rowNumbers?.[index] || index + 1;
  let unsafeStrings = 0, refundSummaryCount = 0;
  for (let index = header.index + 1; index < rows.length; index++) {
    const row = rows[index];
    const rowNumber = physicalRow(index);
    if (!Array.isArray(row)) { skipped.push({row: rowNumber, reason: '不是有效的数据行'}); continue; }
    if (row.every(missing)) continue;
    const get = key => map[key] === undefined ? '' : text(row[map[key]]);
    const raw = key => map[key] === undefined ? '' : row[map[key]];
    const reasons = [], information = [];
    if (headerMap(row).date !== undefined && (headerMap(row).amount !== undefined || headerMap(row).expenseAmount !== undefined)) { skipped.push({row: rowNumber, reason: '重复表头'}); continue; }
    const direction = get('direction'), businessType = get('businessType'), status = get('status');
    if (/关闭|失败|未支付|未付款|待支付|待付款|等待付款|已撤销|已取消|cancelled|canceled|failed|unpaid/i.test(status)) { skipped.push({row: rowNumber, reason: `交易未完成：${status}`}); continue; }
    const explicitRefund = /^(?:退款|退货退款|refund)$/i.test(direction) || /退款|退货退款|商户退费/.test(businessType);
    const currency = get('currency');
    if (currency && !/^(?:CNY|RMB|人民币|元|¥|￥)$/i.test(currency)) { skipped.push({row: rowNumber, reason: `暂仅支持人民币，未换算币种：${currency}`}); continue; }
    let dateInput = raw('date');
    if (missing(dateInput)) {
      const fallbackIndex = result.headers.findIndex((label, column) => column !== map.date && aliasIndex.get(normalizeHeader(label))?.field === 'date' && !missing(row[column]));
      if (fallbackIndex >= 0) {
        dateInput = row[fallbackIndex];
        reasons.push(`${result.headers[map.date]}缺失，暂用${result.headers[fallbackIndex]}，请核对交易日期`);
      }
    }
    const parsedDate = dateValue(dateInput);
    if (parsedDate.error) { skipped.push({row: rowNumber, reason: parsedDate.error}); continue; }
    if (parsedDate.warning) reasons.push(parsedDate.warning);
    let amountInput = raw('amount');
    let inferredDirection = direction;
    if (missing(amountInput) && (map.expenseAmount !== undefined || map.incomeAmount !== undefined)) {
      const expense = money(raw('expenseAmount')), income = money(raw('incomeAmount'));
      const invalidExpense = !missing(raw('expenseAmount')) && expense.error;
      const invalidIncome = !missing(raw('incomeAmount')) && income.error;
      if (invalidExpense || invalidIncome) { skipped.push({row: rowNumber, reason: `${invalidExpense ? '支出' : '收入'}列${invalidExpense || invalidIncome}`}); continue; }
      const hasExpense = !expense.error && expense.cents > 0, hasIncome = !income.error && income.cents > 0;
      if (hasExpense && hasIncome) { skipped.push({row: rowNumber, reason: '同一行同时有收入和支出金额，未擅自合并'}); continue; }
      if (hasExpense) {
        amountInput = raw('expenseAmount');
        if (missing(inferredDirection)) inferredDirection = '支出';
        else if (/^(?:收入|收|入账|income|credit|in)$/i.test(inferredDirection)) reasons.push('收支方向与支出金额列冲突，请核对');
      } else if (hasIncome) {
        amountInput = raw('incomeAmount');
        if (missing(inferredDirection)) inferredDirection = '收入';
        else if (/^(?:支出|支|消费|付款|expense|debit|out)$/i.test(inferredDirection)) reasons.push('收支方向与收入金额列冲突，请核对');
      }
    }
    // A dedicated refund row can provide a refund amount in its own column.
    const refundAmount = money(raw('refundAmount'));
    if (!missing(raw('refundAmount')) && refundAmount.error) {
      if (explicitRefund) { skipped.push({row: rowNumber, reason: `退款${refundAmount.error}`}); continue; }
      reasons.push('附带的退款金额格式无效，请核对退款流水');
    }
    const originalOutgoing = /^(?:支出|支|消费|付款|expense|debit|out)$/i.test(direction) && !explicitRefund;
    const incomingRefund = /^(?:收入|收|入账|income|credit|in)$/i.test(direction) && /退款成功|退款完成|退款到账|已(?:全额|部分)?退款/.test(status);
    if ((explicitRefund || incomingRefund) && !refundAmount.error && refundAmount.cents > 0) amountInput = raw('refundAmount');
    const amount = money(amountInput);
    if (amount.error) { skipped.push({row: rowNumber, reason: amount.error}); continue; }
    if (amount.cents <= 0) { skipped.push({row: rowNumber, reason: '金额为零，未生成收支记录'}); continue; }
    const typed = classifyType(inferredDirection, businessType, status, amount);
    if (typed.warning) reasons.push(typed.warning);
    const refundProcessing = /退款中|退款处理中|退款申请|退款受理|待退款/.test(status);
    const originalRefundSummary = originalOutgoing && (/退款|全额退回/.test(status) || (!refundAmount.error && refundAmount.cents > 0));
    if (originalRefundSummary) {
      refundSummaryCount++;
      information.push(`原支付状态：${status || '含退款汇总'}；保留原日期和原支出总额，只有独立退款流水才抵减支出`);
      if (!refundAmount.error && refundAmount.cents > 0) information.push(`原单附带退款汇总 ${Math.floor(refundAmount.cents / 100)}.${pad(refundAmount.cents % 100)} 元；未由汇总创建新退款`);
    } else if (refundProcessing) reasons.push('退款尚未明确到账，需核对退款状态及实际到账日期');
    if (!refundAmount.error && refundAmount.cents > 0 && typed.type !== 'refund' && !originalRefundSummary) reasons.push('原交易附有退款汇总，未自动创建另一笔退款，请核对独立退款流水');
    if (map.status !== undefined && missing(status)) reasons.push('交易状态缺失，请确认已经完成');
    if (!originalRefundSummary && /pending|processing|待确认|待核对|等待|处理中|支付中|付款中|受理中/i.test(status)) reasons.push('交易尚待确认或处理');
    const completeStatus = /^(?:(?:交易|支付|付款|收款)?成功|已确认|已完成|已支付|已收款|已收钱|已到账|已入账|充值完成|提现已到账|还款成功|退款成功|退款完成|退款到账|退款入账|已退回|success|succeeded|completed|settled|refunded)$/i.test(status)
      || /^已(?:全额|部分)?退款(?:\s*[（(]?[¥￥]?\s*\d+(?:\.\d{1,2})?[)）]?)?$/.test(status);
    if (!missing(status) && !completeStatus && !originalRefundSummary && !reasons.some(reason => /退款|尚待确认/.test(reason))) reasons.push(`交易状态未识别（${status}），请确认已经完成`);
    if (metadata.malformed?.has(rowNumber)) reasons.push('这一行存在非标准或未闭合引号，请核对原文件');
    const overflow = row.slice(result.headers.length).some(value => !missing(value));
    if (overflow) reasons.push('数据列数多于表头，可能存在分隔符或列错位');
    const merchant = !missing(get('merchant')) ? get('merchant') : !missing(get('goods')) ? get('goods') : '未识别商户';
    const goods = missing(get('goods')) ? '' : get('goods');
    const originalCategory = get('category');
    const category = categoryFor(merchant, goods, originalCategory, options.rules);
    const transactionId = readIdentifier(row, map, 'sourceId');
    const refundId = readIdentifier(row, map, 'refundId');
    const id = typed.type === 'refund' && refundId.value ? refundId : transactionId;
    const orderId = readIdentifier(row, map, 'merchantOrderId');
    if (id.warning) reasons.push(id.warning);
    if (typed.type === 'refund' && refundId.warning) reasons.push(refundId.warning);
    if (orderId.warning && !id.value) reasons.push(orderId.warning);
    const sourceId = id.value || orderId.value;
    const notes = [];
    if (!missing(get('notes'))) notes.push(get('notes'));
    if (goods && goods !== merchant) notes.push(`商品：${goods}`);
    if (originalCategory && !CATEGORIES.includes(originalCategory)) notes.push(`原分类：${originalCategory}`);
    if (!missing(get('paymentMethod'))) notes.push(`支付方式：${get('paymentMethod')}`);
    if (get('originalId')) notes.push(`原交易号：${get('originalId')}`);
    if (/^[\s]*[=+@-]/.test(merchant) || notes.some(value => /^[\s]*[=+@-]/.test(value))) unsafeStrings++;
    drafts.push({
      date: parsedDate.date,
      amountCents: amount.cents,
      type: typed.type,
      merchant,
      category,
      channel: channelFor(`${get('channel')} ${get('paymentMethod')}`, result.format),
      source: 'import',
      sourceId,
      // Put review reasons first so the core's bounded note length preserves them.
      notes: [...new Set(reasons), ...information, ...notes].join('；'),
      status: reasons.length ? 'pending' : 'confirmed',
    });
  }
  if (unsafeStrings) warnings.push(`有 ${unsafeStrings} 条名称或备注类似表格公式，已作为普通文字读取；导出到表格软件时仍需转义`);
  if (refundSummaryCount) warnings.push(`有 ${refundSummaryCount} 笔原支付含退款状态或汇总：原支出已保留，请同时核对独立退款流水；未用汇总猜测退款日期或重复生成退款`);
  if (!drafts.length && !skipped.length) warnings.push('表头后没有可导入的交易');
  if (drafts.some(draft => !draft.sourceId)) warnings.push('部分记录缺少交易号，去重需结合日期、金额和商户核对');
  return result;
}

export function parseRows(rowsArray, {filename = '', rules = {}} = {}) {
  return parseRowsInternal(rowsArray, {filename, rules});
}

export function parseDelimited(input, {filename = '', rules = {}} = {}) {
  const candidates = [',', '\t', ';'].map(delimiter => {
    const parsed = splitDelimited(input, delimiter);
    const header = findHeader(parsed.rows);
    return {delimiter, parsed, score: header?.score ?? -1};
  });
  candidates.sort((a, b) => b.score - a.score);
  const selected = candidates[0];
  const result = parseRowsInternal(selected.parsed.rows, {filename, rules}, selected.parsed);
  if (selected.parsed.malformed.size) result.warnings.push('文件含非标准或未闭合引号，相关行需人工核对');
  return result;
}
