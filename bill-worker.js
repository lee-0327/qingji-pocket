/* Classic Worker: local SheetJS reader + original Qingji importer, no network API. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DRAFTS = 10_000;
const MAX_ROWS = 30_000;
const MAX_COLUMNS = 128;
const MAX_CELLS = 600_000;
const MAX_SHEETS = 24;
const MAX_CELL_CHARACTERS = 20_000;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
let busy = false;

class BillError extends Error {}
const fail = message => { throw new BillError(message); };
const progress = (stage, message, value) => self.postMessage({type: 'progress', stage, message, progress: value});
const shortName = value => String(value ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 120);

function decodeCSV(bytes) {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return {text: new TextDecoder('utf-16le', {fatal: true}).decode(bytes), encoding: 'UTF-16LE'};
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return {text: new TextDecoder('utf-16be', {fatal: true}).decode(bytes), encoding: 'UTF-16BE'};
    // Some spreadsheet programs omit the UTF-16 BOM. Only use the zero-byte
    // pattern when the alternative is a text file containing many NULs.
    const length = Math.min(bytes.length - (bytes.length % 2), 8192);
    let evenZeros = 0, oddZeros = 0;
    for (let index = 0; index < length; index += 2) {
      if (bytes[index] === 0) evenZeros++;
      if (bytes[index + 1] === 0) oddZeros++;
    }
    const pairs = length / 2;
    if (pairs > 8 && oddZeros / pairs > 0.2 && oddZeros > evenZeros * 3) return {text: new TextDecoder('utf-16le', {fatal: true}).decode(bytes), encoding: 'UTF-16LE'};
    if (pairs > 8 && evenZeros / pairs > 0.2 && evenZeros > oddZeros * 3) return {text: new TextDecoder('utf-16be', {fatal: true}).decode(bytes), encoding: 'UTF-16BE'};
    try { return {text: new TextDecoder('utf-8', {fatal: true}).decode(bytes), encoding: 'UTF-8'}; }
    catch { return {text: new TextDecoder('gb18030', {fatal: true}).decode(bytes), encoding: 'GBK/GB18030'}; }
  } catch {
    fail('没有识别出这份 CSV 的文字编码。请在原软件中导出 UTF-8 CSV 后再试。');
  }
}

/** Bound declared ZIP expansion before allowing the spreadsheet library to read it. */
function inspectZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index--) {
    if (view.getUint32(index, true) === 0x06054b50 && index + 22 + view.getUint16(index + 20, true) === bytes.length) { end = index; break; }
  }
  if (end < 0) fail('这份 XLSX 文件不完整，请重新导出后再试。');
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count === 0xffff || directorySize === 0xffffffff || offset === 0xffffffff) fail('这份表格的压缩方式暂不支持，请先导出 CSV 后再试。');
  if (!count || count > 2000 || offset + directorySize > end) fail('这份表格内容过多或文件不完整，请按月份重新导出。');
  const directoryEnd = offset + directorySize;
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50) fail('这份 XLSX 文件不完整，请重新导出后再试。');
    if (view.getUint16(offset + 8, true) & 1) fail('这份表格有密码保护，请先取消密码或导出无密码的 CSV 再导入。');
    const size = view.getUint32(offset + 24, true);
    if (size === 0xffffffff || view.getUint32(offset + 20, true) === 0xffffffff) fail('这份表格的压缩方式暂不支持，请先导出 CSV 后再试。');
    expanded += size;
    if (expanded > MAX_EXPANDED_BYTES) fail('这份表格解开后的内容太大。请按月份导出账单，再分批导入。');
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (offset > directoryEnd) fail('这份 XLSX 文件不完整，请重新导出后再试。');
  }
}

function checkResult(result) {
  if (result.drafts.length > MAX_DRAFTS) fail('一次最多导入 10,000 笔，请按月份拆分账单后再导入。');
  for (const draft of result.drafts) {
    for (const value of Object.values(draft)) {
      if (typeof value === 'string' && value.length > MAX_CELL_CHARACTERS) fail('账单中有一格文字过长，请删去大段说明，或重新导出原始账单。');
    }
  }
  if (result.warnings.some(value => value.length > MAX_CELL_CHARACTERS) || result.skipped.some(value => String(value.reason).length > MAX_CELL_CHARACTERS)) fail('账单中有一格文字过长，请删去大段说明，或重新导出原始账单。');
  return result;
}

function excelCell(cell, facts) {
  if (!cell) return '';
  if (cell.f !== undefined || cell.F !== undefined) {
    facts.formulas++;
    // Never use cached formula results: an amount formula must be rejected by
    // the importer, while text formulas remain literal text without execution.
    return `=${String(cell.f ?? '数组公式（未计算）')}`;
  }
  const value = cell.v ?? '';
  if (typeof value === 'string' && value.length > MAX_CELL_CHARACTERS) fail('表格中有一格文字过长，请清理大段说明后再导入。');
  if (cell.t === 'e') { facts.errors++; return '表格单元格错误（未读取值）'; }
  if (typeof value === 'number') {
    // Do not erase an explicit foreign-currency or percentage display and turn
    // it into a seemingly plain RMB amount. The importer will refuse this text.
    if (typeof cell.w === 'string' && /[$€£₩₹₽฿₫₱%]|\b(?:USD|EUR|GBP|HKD|JPY|KRW|AUD|CAD|SGD|TWD)\b/i.test(cell.w)) return cell.w;
    // Preserve display-only leading zeroes only when the underlying integer is
    // exact. A formatted display can never recover a rounded long numeric ID.
    if (Number.isSafeInteger(value) && typeof cell.w === 'string' && /^0\d+$/.test(cell.w) && BigInt(cell.w) === BigInt(value)) return cell.w;
    return value;
  }
  return value;
}

function readWorkbook(buffer, filename, rules, importer) {
  inspectZip(new Uint8Array(buffer));
  progress('spreadsheet', '正在本机解开表格…', 0.25);
  try { importScripts('./vendor/xlsx.full.min.js'); }
  catch { fail('本地表格组件还没准备好，请联网打开一次页面后再试；账单不会上传。'); }
  if (!self.XLSX?.read || !self.XLSX?.utils) fail('本地表格组件未能加载，请刷新页面后再试。');
  const XLSX = self.XLSX;
  let workbook;
  try {
    workbook = XLSX.read(buffer, {type: 'array', cellFormula: true, cellNF: true, cellText: true, cellDates: false, sheetRows: MAX_ROWS + 1, bookVBA: false, bookDeps: false});
  } catch (error) {
    if (/password|encrypt/i.test(String(error?.message))) fail('这份表格有密码保护，请先取消密码或导出无密码的 CSV 再导入。');
    fail('没能读懂这份 XLSX 表格，请重新导出；也可以改用 CSV 文件。');
  }
  if (workbook.Workbook?.WBProps?.date1904 === true || workbook.Workbook?.WBProps?.date1904 === 1 || workbook.Workbook?.WBProps?.date1904 === '1') fail('这份表格使用旧的 1904 日期方式，直接读取可能让日期偏移。请先用 Excel 或 Numbers 导出 CSV 后再导入。');
  if (!workbook.SheetNames?.length) fail('表格中没有工作表，请重新导出账单。');
  if (workbook.SheetNames.length > MAX_SHEETS) fail('这份表格超过 24 张工作表，请只保留账单相关的表，或分批导入。');
  const result = {format: 'generic', drafts: [], skipped: [], warnings: [], headers: [], sheets: []};
  const formats = new Set();
  let totalRows = 0, totalCells = 0, matchedSheets = 0;
  workbook.SheetNames.forEach((name, sheetIndex) => {
    const sheet = workbook.Sheets[name];
    const label = shortName(name);
    const info = {name: label, format: 'generic', headerFound: false, draftsCount: 0, skippedCount: 0, hidden: Boolean(workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden)};
    result.sheets.push(info);
    progress('rows', `正在检查工作表 ${sheetIndex + 1}/${workbook.SheetNames.length}：${label}`, 0.4 + 0.5 * sheetIndex / workbook.SheetNames.length);
    if (!sheet?.['!ref']) {
      result.warnings.push(`工作表「${label}」为空，未导入。`); return;
    }
    const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
    const rowCount = range.e.r - range.s.r + 1;
    const columns = range.e.c - range.s.c + 1;
    totalRows += rowCount;
    totalCells += rowCount * columns;
    if (range.e.r >= MAX_ROWS || totalRows > MAX_ROWS) fail('表格超过 30,000 行（含表头、说明和空行范围），请按月份拆分后导入。');
    if (columns > MAX_COLUMNS || range.e.c >= MAX_COLUMNS || totalCells > MAX_CELLS) fail('这份表格的列数或空白范围太大，请删去多余空白行列，或导出 CSV 后再试。');
    const rows = [], facts = {formulas: 0, errors: 0};
    for (let row = range.s.r; row <= range.e.r; row++) {
      const values = [];
      for (let column = range.s.c; column <= range.e.c; column++) values.push(excelCell(sheet[XLSX.utils.encode_cell({r: row, c: column})], facts));
      rows.push(values);
    }
    const parsed = importer.parseRows(rows, {filename: `${filename} ${label}`, rules});
    info.format = parsed.format;
    info.headerFound = parsed.headers.length > 0;
    info.draftsCount = parsed.drafts.length;
    info.skippedCount = parsed.skipped.length;
    if (!info.headerFound) {
      result.warnings.push(`工作表「${label}」未找到含日期和金额的账单表头，未导入。`); return;
    }
    matchedSheets++;
    formats.add(parsed.format);
    result.drafts.push(...parsed.drafts);
    result.skipped.push(...parsed.skipped.map(item => ({...item, row: item.row + range.s.r, sheet: label})));
    for (const header of parsed.headers) if (!result.headers.includes(header)) result.headers.push(header);
    result.warnings.push(`工作表「${label}」${info.hidden ? '（隐藏表也已检查）' : ''}：读取 ${parsed.drafts.length} 笔，跳过 ${parsed.skipped.length} 行。`);
    if (range.s.r) result.warnings.push(`工作表「${label}」从原文件第 ${range.s.r + 1} 行开始读取，跳过行号对应原表。`);
    result.warnings.push(...parsed.warnings.map(warning => `「${label}」${warning}`));
    if (facts.formulas) result.warnings.push(`「${label}」含 ${facts.formulas} 个公式单元格：没有执行公式，也没有使用缓存结果；金额公式不用于入账，无法确认金额的行会跳过，文字公式仅作普通文字。`);
    if (facts.errors) result.warnings.push(`「${label}」含 ${facts.errors} 个错误单元格，相关记录请核对。`);
    checkResult(result);
  });
  if (formats.size === 1) result.format = [...formats][0];
  if (formats.size > 1) result.warnings.push('文件含不同账单格式，已分别读取后合并预览，请核对渠道。');
  result.warnings.unshift(`共检查 ${workbook.SheetNames.length} 张工作表；读取 ${matchedSheets} 张含账单表头的工作表。`);
  if (!matchedSheets) result.warnings.push('未发现可导入的账单，请确认原文件包含日期和金额表头。');
  return checkResult(result);
}

self.onmessage = async ({data}) => {
  if (busy || data?.type !== 'read') return;
  busy = true;
  try {
    const {buffer, filename = '', rules = {}} = data;
    if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength) fail('没有读到文件内容，请重新选择账单。');
    if (buffer.byteLength > MAX_FILE_BYTES) fail('文件超过 5 MB，请按月份导出后分批导入。');
    progress('preparing', '正在准备本地账单读取规则…', 0.12);
    const importer = await import('./lib/importer.js');
    const bytes = new Uint8Array(buffer);
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    let result;
    if (isZip) result = readWorkbook(buffer, filename, rules, importer);
    else {
      if (/\.xlsx$/i.test(filename)) {
        if (bytes[0] === 0xd0 && bytes[1] === 0xcf) fail('这份表格可能有密码保护，或使用旧版格式。请先导出无密码的 CSV 或 XLSX 再试。');
        fail('这不是完整的 XLSX 表格，请从原软件重新导出后再试。');
      }
      progress('decoding', '正在本机识别文字编码…', 0.3);
      const decoded = decodeCSV(bytes);
      if (decoded.text.includes('\u0000')) fail('文件中有无法识别的内容，请重新导出 UTF-8 CSV 或 XLSX 账单。');
      let lines = 1;
      for (let index = 0; index < decoded.text.length; index++) {
        if ((decoded.text[index] === '\n' || decoded.text[index] === '\r' && decoded.text[index + 1] !== '\n') && ++lines > MAX_ROWS) fail('文件超过 30,000 行（含说明和换行），请按月份导出后分批导入。');
      }
      progress('rows', '正在识别账单表头和收支信息…', 0.55);
      result = checkResult(importer.parseDelimited(decoded.text, {filename, rules}));
      result.encoding = decoded.encoding;
      result.warnings.unshift(`已在本机按 ${decoded.encoding} 编码读取文件。`);
    }
    self.postMessage({type: 'result', result});
  } catch (error) {
    self.postMessage({type: 'error', message: error instanceof BillError ? error.message : '读取账单时遇到问题，请重新导出文件；Excel 表格也可以改用 CSV 再试。'});
  }
};
