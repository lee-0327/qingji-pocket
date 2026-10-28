import { checkForUpdate, activateUpdate } from './lib/updates.js';

const button = document.getElementById('run-update');
const message = document.getElementById('update-message');
const status = text => { message.textContent = text; };

button.addEventListener('click', async () => {
  button.disabled = true;
  button.textContent = '正在更新…';
  try {
    const result = await checkForUpdate({ onStatus: status });
    if (result.worker) await activateUpdate(result.registration, { onStatus: status });
    status('程序已就绪，正在回到账本…');
    location.replace(new URL('./', import.meta.url).href);
  } catch (error) {
    status(error?.message || '这次更新未完成。请联网重试，已有账目仍保留。');
    button.textContent = '重新检查并更新';
    button.disabled = false;
  }
});
