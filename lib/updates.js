// The updater is version-agnostic and never reads or changes ledger storage.
const ROOT = new URL('../', import.meta.url);
const DEFAULT_TIMEOUT_MS = 45_000;

function status(callback, message) {
  if (typeof callback !== 'function') return;
  try { callback(message); } catch { /* Status rendering cannot stop an update. */ }
}

function serviceWorkers() {
  if (!globalThis.isSecureContext || !globalThis.navigator?.serviceWorker) {
    throw new Error('当前页面不能检查更新，请在 Safari 中用原来的 HTTPS 地址打开。');
  }
  return navigator.serviceWorker;
}

function timeoutError() {
  return new Error('检查或安装更新超时，请保持联网后重试。现有账目仍保存在本机。');
}

function remaining(deadline) {
  return Math.max(1, deadline - Date.now());
}

function bounded(promise, deadline) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError()), remaining(deadline));
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function waitForState(worker, accepted, deadline) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error) => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', inspect);
      error ? reject(error) : resolve(worker);
    };
    const inspect = () => {
      if (accepted.includes(worker.state)) finish();
      else if (worker.state === 'redundant') finish(new Error('新版安装未完成，请保持联网后重新检查。原账本没有清空。'));
    };
    worker.addEventListener('statechange', inspect);
    timer = setTimeout(() => finish(timeoutError()), remaining(deadline));
    inspect();
  });
}

/** Read the worker's own version, not a page's guess from the cache name.
 * Old workers need not support GET_VERSION: they resolve to null in 1.5s.
 */
export function getWorkerVersion(worker, { timeoutMs = 1500 } = {}) {
  if (!worker?.postMessage || !globalThis.MessageChannel) return Promise.resolve(null);
  return new Promise(resolve => {
    const channel = new MessageChannel();
    let settled = false;
    let timer;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.port1.onmessage = null;
      channel.port1.onmessageerror = null;
      channel.port1.close(); channel.port2.close();
      resolve(value);
    };
    channel.port1.onmessage = event => {
      const value = event.data?.version;
      finish(typeof value === 'string' && value.length > 0 && value.length <= 160 ? value : null);
    };
    channel.port1.onmessageerror = () => finish(null);
    timer = setTimeout(() => finish(null), timeoutMs);
    try { worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]); }
    catch { finish(null); }
  });
}

/** Explicitly check the existing origin/scope and wait for any installation.
 * Snapshots and listeners cover installation before register() resolves,
 * before updatefound is attached, and during the explicit update() request.
 */
export async function checkForUpdate({ onStatus, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const container = serviceWorkers();
  if (globalThis.navigator.onLine === false) throw new Error('当前离线，请联网后再检查更新。离线记账仍可使用。');
  const deadline = Date.now() + timeoutMs;
  status(onStatus, '正在检查更新…');
  let registration;
  let latestInstalling = null;
  const observe = () => { if (registration.installing) latestInstalling = registration.installing; };
  try {
    registration = await bounded(container.register(new URL('sw.js', ROOT).href, { scope: ROOT.href, updateViaCache: 'none' }), deadline);
    observe();
    registration.addEventListener('updatefound', observe);
    // A previously waiting worker can itself be older than today's release.
    // Fetch explicitly and prefer a new installation over that stale waiter.
    await bounded(registration.update(), deadline);
    observe();
    let worker = registration.installing || latestInstalling || registration.waiting;
    if (worker && !['installed', 'activated'].includes(worker.state)) {
      status(onStatus, '正在下载并准备新版…');
      await waitForState(worker, ['installed', 'activated'], deadline);
    }
    worker = registration.waiting || (worker?.state === 'installed' ? worker : null);
    if (worker) {
      status(onStatus, '新版已准备好，可以更新页面。');
      return { registration, worker, status: 'ready' };
    }
    status(onStatus, '当前已经是最新版本。');
    return { registration, worker: null, status: 'current' };
  } catch (error) {
    if (error?.message && /[\u4e00-\u9fff]/.test(error.message)) throw error;
    throw new Error('暂时无法检查更新，请确认网络正常后重试。现有账目仍保存在本机。', { cause: error });
  } finally {
    registration?.removeEventListener('updatefound', observe);
  }
}

/** Activate only after the caller has handled any unsaved draft. This function
 * never navigates, clears caches, unregisters workers or changes IndexedDB.
 */
export async function activateUpdate(registrationOrWorker, { onStatus, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const container = serviceWorkers();
  const deadline = Date.now() + timeoutMs;
  const registration = registrationOrWorker?.postMessage ? null : registrationOrWorker;
  let worker = registration?.waiting || registration?.installing || registration?.active || registrationOrWorker;
  if (!worker?.postMessage) throw new Error('还没有可安装的新版，请先检查更新。');
  if (worker.state === 'redundant') throw new Error('这个更新已失效，请重新检查更新。');
  if (worker.state !== 'activated') {
    status(onStatus, '正在安装更新，请稍等…');
    if (!['installed', 'activating'].includes(worker.state)) await waitForState(worker, ['installed', 'activated'], deadline);
    worker = registration?.waiting || worker;
    if (worker.state !== 'activated') {
      await new Promise((resolve, reject) => {
        let timer;
        const finish = error => {
          clearTimeout(timer);
          worker.removeEventListener('statechange', inspect);
          container.removeEventListener('controllerchange', inspect);
          error ? reject(error) : resolve();
        };
        const inspect = () => {
          if (worker.state === 'activated') finish();
          else if (worker.state === 'redundant') finish(new Error('这个更新未能安装，请重新检查更新。'));
        };
        worker.addEventListener('statechange', inspect);
        container.addEventListener('controllerchange', inspect);
        timer = setTimeout(() => finish(timeoutError()), remaining(deadline));
        try { worker.postMessage({ type: 'SKIP_WAITING' }); }
        catch (error) { finish(new Error('无法启动更新，请重新检查后再试。', { cause: error })); return; }
        inspect();
      });
    }
  }
  status(onStatus, '更新已安装。');
  return { worker, version: await getWorkerVersion(worker) };
}
