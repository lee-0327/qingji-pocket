/** Local bill reader. Spreadsheet parsing stays in a disposable classic Worker. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 100_000;

function cancelledError() {
  return new DOMException('已取消读取账单。', 'AbortError');
}

/**
 * @param {File} file
 * @param {{rules?:object,onProgress?:(event:{stage:string,message:string,progress:number})=>void,signal?:AbortSignal}} options
 * @returns {Promise<{format:string,drafts:object[],skipped:object[],warnings:string[],headers:string[],sheets?:object[]}>}
 */
export function readBillFile(file, {rules = {}, onProgress, signal} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelledError()); return; }
    if (!file || typeof file.arrayBuffer !== 'function') {
      reject(new Error('请先选择一份 CSV 或 XLSX 账单。')); return;
    }
    if (!Number.isFinite(file.size) || file.size <= 0) {
      reject(new Error('这份文件是空的，请重新导出账单。')); return;
    }
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error('文件超过 5 MB，请按月份导出后分批导入。')); return;
    }
    if (!/\.(?:csv|tsv|txt|xlsx)$/i.test(file.name || '')) {
      reject(new Error('目前支持 CSV、TSV 和 XLSX 文件。请先从微信或支付宝导出这类账单。')); return;
    }
    if (typeof Worker !== 'function') {
      reject(new Error('当前浏览器无法在后台读取账单，请用 iPhone 的 Safari 打开后再试。')); return;
    }

    let worker, finished = false, timer;
    const report = event => {
      if (!finished && typeof onProgress === 'function') {
        // A view callback must not interrupt parsing or leave the Worker alive.
        try { onProgress(event); } catch { /* The result is independent of progress UI. */ }
      }
    };
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(cancelledError());
    signal?.addEventListener('abort', abort, {once: true});
    timer = setTimeout(() => finish(new Error('读取超过 100 秒，已停止。请按月份导出小一些的账单再试。')), TIMEOUT_MS);
    report({stage: 'reading', message: '正在读取本地账单…', progress: 0.03});

    Promise.resolve().then(() => {
      if (finished) return null;
      return file.arrayBuffer();
    }).then(buffer => {
      if (finished) return;
      if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength) {
        finish(new Error('没有读到文件内容，请重新选择账单。')); return;
      }
      if (buffer.byteLength > MAX_FILE_BYTES) {
        finish(new Error('文件超过 5 MB，请按月份导出后分批导入。')); return;
      }
      worker = new Worker(new URL('../bill-worker.js', import.meta.url));
      worker.onmessage = ({data}) => {
        if (finished || !data || typeof data !== 'object') return;
        if (data.type === 'progress') {
          report({stage: String(data.stage || 'parsing'), message: String(data.message || '正在读取…'), progress: Math.max(0, Math.min(1, Number(data.progress) || 0))});
        } else if (data.type === 'error') {
          finish(new Error(typeof data.message === 'string' ? data.message : '账单未能读取，请重新导出后再试。'));
        } else if (data.type === 'result') {
          const result = data.result;
          if (!result || !Array.isArray(result.drafts) || !Array.isArray(result.skipped) || !Array.isArray(result.warnings) || !Array.isArray(result.headers)) {
            finish(new Error('账单读取结果不完整，请重新导出后再试。')); return;
          }
          report({stage: 'done', message: '读取完成，请核对后导入。', progress: 1});
          finish(null, result);
        }
      };
      worker.onerror = event => {
        event.preventDefault?.();
        finish(new Error('本地账单读取组件未能运行。请刷新页面；仍有问题时可先导出 CSV 再试。'));
      };
      worker.onmessageerror = () => finish(new Error('账单读取结果未能传回，请重新导出小一些的文件再试。'));
      // Transfer, rather than copy, the bytes. Nothing is sent to a server.
      worker.postMessage({type: 'read', buffer, filename: file.name, rules}, [buffer]);
    }).catch(() => finish(new Error('无法读取这份文件，请确认它仍保存在手机上，再重新选择。')));
  });
}
