// Local-only OCR. No image or recognized text is sent to a server.
// Tesseract.js 6.0.1 + core 6.0.0 + pinned tessdata_fast resources.
import { parseReceiptReadings } from './core.js';
const ROOT = new URL('../', import.meta.url);
const VERSION = 'tesseract6.0.1-core6.0.0-fast87416418-v1';
export const OCR_CACHE = `qingji-ocr-${VERSION}`;

const RELATIVE_ASSETS = [
  'OCR-ASSETS.json',
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  ...['tesseract-core', 'tesseract-core-simd', 'tesseract-core-lstm', 'tesseract-core-simd-lstm']
    .flatMap(stem => [`vendor/tesseract/core/${stem}.wasm.js`, `vendor/tesseract/core/${stem}.wasm`]),
  'vendor/tesseract/lang/chi_sim.traineddata',
  'vendor/tesseract/lang/eng.traineddata',
];

export const OCR_ASSETS = Object.freeze(RELATIVE_ASSETS.map(path => new URL(path, ROOT).href));
const MANIFEST_URL = OCR_ASSETS[0];
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 32_000_000;
const MAX_WORK_PIXELS = 3_200_000;
const MAX_WORK_EDGE = 3000;
const JOB_TIMEOUT_MS = 100_000;
let currentJob = null;
let libraryPromise = null;

function progress(callback, detail) {
  if (typeof callback !== 'function') return;
  try { callback(detail); } catch { /* UI updates must not break recognition. */ }
}

function cancellation(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException('已取消识别', 'AbortError');
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new DOMException('已取消识别', 'AbortError'));
  return new Promise((resolve, reject) => {
    const stopped = () => {
      signal.removeEventListener('abort', stopped);
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('已取消识别', 'AbortError'));
    };
    signal.addEventListener('abort', stopped, { once: true });
    promise.then(value => { signal.removeEventListener('abort', stopped); resolve(value); }, error => { signal.removeEventListener('abort', stopped); reject(error); });
  });
}

function requireCacheStorage() {
  if (!globalThis.caches || !globalThis.crypto?.subtle) {
    throw new Error('当前页面不能准备离线识别，请使用 HTTPS 或本机 localhost 打开。');
  }
}

function validateManifest(manifest) {
  if (manifest?.version !== VERSION || !Array.isArray(manifest.assets)) {
    throw new Error('识别资料版本不一致，请重新准备离线包。');
  }
  const entries = new Map(manifest.assets.map(item => [item.path, item]));
  for (const relative of RELATIVE_ASSETS.slice(1)) {
    const item = entries.get(relative);
    if (!item || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || !/^[a-f0-9]{64}$/.test(item.sha256)) {
      throw new Error('识别资料清单不完整，请重新下载制作包。');
    }
  }
  return entries;
}

async function digestMatches(response, metadata) {
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== metadata.bytes) return false;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return hex === metadata.sha256;
}

export async function isOCRReady() {
  if (!globalThis.caches) return false;
  try {
    const cache = await caches.open(OCR_CACHE);
    const manifestResponse = await cache.match(MANIFEST_URL);
    if (!manifestResponse?.ok) return false;
    validateManifest(await manifestResponse.json());
    for (const url of OCR_ASSETS.slice(1)) {
      if (!(await cache.match(url))?.ok) return false;
    }
    return true;
  } catch { return false; }
}

export async function prepareOCR({ onProgress, signal } = {}) {
  requireCacheStorage();
  cancellation(signal);
  const cache = await caches.open(OCR_CACHE);
  let manifestResponse = await cache.match(MANIFEST_URL);
  if (!manifestResponse?.ok) {
    try {
      manifestResponse = await fetch(MANIFEST_URL, { cache: 'no-cache', credentials: 'same-origin', signal });
    } catch (error) {
      cancellation(signal);
      throw new Error('还没有完整的离线识别包。请联网后点“准备离线识别”。', { cause: error });
    }
    if (!manifestResponse.ok) throw new Error('无法读取离线识别清单，请检查工具文件是否完整。');
  }
  const manifest = await manifestResponse.clone().json();
  const entries = validateManifest(manifest);
  await cache.put(MANIFEST_URL, manifestResponse.clone());
  const totalBytes = RELATIVE_ASSETS.slice(1).reduce((sum, item) => sum + entries.get(item).bytes, 0);
  let completedBytes = 0;
  let nextIndex = 1;
  let completedFiles = 0;
  progress(onProgress, { phase: 'prepare', status: '检查并准备离线识别资料', progress: 0, completedBytes, totalBytes });

  const downloadOne = async relative => {
    cancellation(signal);
    const url = new URL(relative, ROOT).href;
    const metadata = entries.get(relative);
    let response = await cache.match(url);
    if (!response?.ok || !(await digestMatches(response, metadata))) {
      cancellation(signal);
      try { response = await fetch(url, { cache: 'no-cache', credentials: 'same-origin', signal }); }
      catch (error) {
        cancellation(signal);
        throw new Error('离线识别资料未准备完整。请联网重试，或先用文字记账。', { cause: error });
      }
      if (!response.ok || (response.url && new URL(response.url).origin !== ROOT.origin) || !(await digestMatches(response, metadata))) {
        throw new Error(`识别资料校验失败：${relative.split('/').at(-1)}。请重新准备。`);
      }
      cancellation(signal);
      await cache.put(url, response.clone());
    }
    cancellation(signal);
    completedBytes += metadata.bytes;
    completedFiles += 1;
    progress(onProgress, { phase: 'prepare', status: '准备离线识别资料', progress: completedBytes / totalBytes, completedBytes, totalBytes, completedFiles, totalFiles: OCR_ASSETS.length - 1 });
  };
  // Limit concurrent byte buffers on memory-constrained phones.
  const runner = async () => {
    while (nextIndex < RELATIVE_ASSETS.length) {
      const index = nextIndex++;
      await downloadOne(RELATIVE_ASSETS[index]);
    }
  };
  await Promise.all([runner(), runner()]);
  cancellation(signal);
  const result = {
    cached: true,
    version: VERSION,
    bytes: totalBytes,
    serviceWorkerControlled: Boolean(globalThis.navigator?.serviceWorker?.controller),
  };
  // CacheStorage alone does not intercept worker fetches without the app's SW.
  result.offlineReady = result.serviceWorkerControlled;
  progress(onProgress, { phase: 'prepare', status: result.offlineReady ? '离线识别资料已准备好' : '资料已缓存；请重新打开工具后做离线测试', progress: 1, completedBytes: totalBytes, totalBytes });
  return result;
}

async function loadLibrary(signal) {
  if (globalThis.Tesseract?.createWorker) return globalThis.Tesseract;
  if (!libraryPromise) {
    libraryPromise = new Promise((resolve, reject) => {
      const url = new URL('vendor/tesseract/tesseract.min.js', ROOT).href;
      const existing = [...document.scripts].find(script => script.src === url);
      const script = existing || document.createElement('script');
      const timeout = setTimeout(() => reject(new Error('识别程序加载超时，请确认离线包已经准备完整。')), 30_000);
      script.addEventListener('load', () => {
        clearTimeout(timeout);
        if (globalThis.Tesseract?.createWorker) resolve(globalThis.Tesseract);
        else reject(new Error('识别程序不完整，请重新下载。'));
      }, { once: true });
      script.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('无法加载本机识别程序，请重新准备离线包。')); }, { once: true });
      if (!existing) { script.src = url; script.async = true; document.head.append(script); }
    }).catch(error => { libraryPromise = null; throw error; });
  }
  return abortable(libraryPromise, signal);
}

async function decodeImage(file, signal) {
  cancellation(signal);
  validateFile(file);
  const objectURL = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  try {
    await abortable(new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('这张图片无法读取，请转成 PNG/JPEG 或重新截屏。'));
      image.src = objectURL;
    }), signal);
    cancellation(signal);
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width * height > MAX_SOURCE_PIXELS) throw new Error('图片尺寸太大，请先裁剪成单笔付款截图。');
    const ratio = Math.min(1, Math.sqrt(MAX_WORK_PIXELS / (width * height)), MAX_WORK_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('当前浏览器无法处理图片，请改用文字记账。');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    image.onload = image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(objectURL);
  }
}

function validateFile(file) {
  if (!(file instanceof Blob) || !file.size) throw new Error('请选择一张有效截图。');
  if (file.size > MAX_FILE_BYTES) throw new Error('图片超过 20 MB，请先裁剪成单笔账单。');
  if (file.type && !file.type.startsWith('image/')) throw new Error('请选择图片文件。账单文件请使用“导入账单”。');
}

async function terminate(job) {
  if (!job.worker) return;
  if (!job.termination) job.termination = Promise.resolve(job.worker.terminate()).catch(() => {});
  await job.termination;
}

export async function recognizeScreenshot(file, { onProgress, signal } = {}) {
  if (currentJob) throw new Error('上一张截图还在识别或结束中，请稍后再试。');
  validateFile(file);
  const controller = new AbortController();
  const stopped = () => controller.abort(signal?.reason || new DOMException('已取消识别', 'AbortError'));
  if (signal?.aborted) stopped();
  else signal?.addEventListener('abort', stopped, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('识别超时，请裁剪截图后重试，或改用文字记账。', 'TimeoutError')), JOB_TIMEOUT_MS);
  const job = { controller, worker: null, workerPromise: null, termination: null };
  currentJob = job;
  let canvas, merchantCanvas;
  try {
    cancellation(controller.signal);
    if (!(await isOCRReady())) await prepareOCR({ onProgress, signal: controller.signal });
    cancellation(controller.signal);
    progress(onProgress, { phase: 'image', status: '准备截图', progress: 0 });
    canvas = await decodeImage(file, controller.signal);
    const Tesseract = await loadLibrary(controller.signal);
    cancellation(controller.signal);
    job.workerPromise = Tesseract.createWorker(['chi_sim', 'eng'], 1, {
      workerPath: new URL('vendor/tesseract/worker.min.js', ROOT).href,
      corePath: new URL('vendor/tesseract/core/', ROOT).href.replace(/\/$/, ''),
      langPath: new URL('vendor/tesseract/lang/', ROOT).href.replace(/\/$/, ''),
      workerBlobURL: false,
      gzip: false,
      cacheMethod: 'none',
      logger: message => {
        if (controller.signal.aborted) return;
        const recognizing = message.status === 'recognizing text';
        progress(onProgress, {
          phase: recognizing ? 'recognize' : 'initialize',
          status: recognizing ? (job.merchantPass ? '正在重点读取店名' : job.supplement ? '正在补读大号金额和分散文字' : '正在读取截图文字') : '正在启动本机识别',
          progress: Number.isFinite(message.progress) ? Math.min(1, Math.max(0, message.progress)) : 0,
        });
      },
    });
    job.workerPromise.then(worker => {
      job.worker = worker;
      if (controller.signal.aborted) return terminate(job);
    }).catch(() => {});
    job.worker = await abortable(job.workerPromise, controller.signal);
    cancellation(controller.signal);
    // A receipt mixes large isolated money with small Chinese detail rows.
    // Read it both as a text block and as sparse text using the same worker.
    // Tesseract SetVariable requires string values for page segmentation.
    await abortable(job.worker.setParameters({ tessedit_pageseg_mode: '6' }), controller.signal);
    const result = await abortable(job.worker.recognize(canvas), controller.signal);
    cancellation(controller.signal);
    job.supplement = true;
    progress(onProgress, { phase: 'recognize', status: '正在补读大号金额和分散文字', progress: 0 });
    await abortable(job.worker.setParameters({ tessedit_pageseg_mode: '11' }), controller.signal);
    const supplement = await abortable(job.worker.recognize(canvas), controller.signal);
    cancellation(controller.signal);
    const reading = value => ({ text: String(value?.data?.text || '').trim(), confidence: Number.isFinite(value?.data?.confidence) ? value.data.confidence : 0 });
    const primary = reading(result);
    const readings = [primary, reading(supplement)];
    const extracted = parseReceiptReadings(readings).drafts[0];
    // Give short, sometimes logo-like merchant headings a closer local read.
    // This extra reading supplies candidates only; the parser rejects conflicts.
    if (extracted && (extracted.merchant === '未识别商户' || extracted.category === '其他')) {
      job.merchantPass = true;
      progress(onProgress, { phase: 'recognize', status: '正在重点读取店名', progress: 0 });
      merchantCanvas = document.createElement('canvas');
      const left = Math.floor(canvas.width * 0.04), top = Math.floor(canvas.height * 0.11);
      merchantCanvas.width = Math.max(1, Math.floor(canvas.width * 0.92));
      merchantCanvas.height = Math.max(1, Math.floor(canvas.height * 0.39));
      const context = merchantCanvas.getContext('2d', { alpha: false });
      if (context) {
        context.fillStyle = '#fff'; context.fillRect(0, 0, merchantCanvas.width, merchantCanvas.height);
        context.drawImage(canvas, left, top, merchantCanvas.width, merchantCanvas.height, 0, 0, merchantCanvas.width, merchantCanvas.height);
        await abortable(job.worker.setParameters({ tessedit_pageseg_mode: '6' }), controller.signal);
        const merchantResult = await abortable(job.worker.recognize(merchantCanvas), controller.signal);
        cancellation(controller.signal);
        readings.push({ ...reading(merchantResult), role: 'merchant' });
      }
    }
    return {
      ...primary,
      readings,
    };
  } catch (error) {
    cancellation(controller.signal);
    if (/[\u4e00-\u9fff]/.test(error?.message || '')) throw error;
    throw new Error('本机识别未完成。请确认离线包完整，或裁剪成单笔截图后重试。', { cause: error });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', stopped);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    if (merchantCanvas) { merchantCanvas.width = 0; merchantCanvas.height = 0; }
    if (job.worker) {
      await terminate(job);
      if (currentJob === job) currentJob = null;
    } else if (job.workerPromise) {
      // A cancelled initialization may resolve later. Do not start a second
      // worker until that one can be terminated through the public API.
      job.workerPromise.then(worker => { job.worker = worker; return terminate(job); }).catch(() => {}).finally(() => { if (currentJob === job) currentJob = null; });
    } else if (currentJob === job) currentJob = null;
  }
}

export async function disposeOCR() {
  const job = currentJob;
  if (!job) return;
  job.controller.abort(new DOMException('已取消识别', 'AbortError'));
  await terminate(job);
}
