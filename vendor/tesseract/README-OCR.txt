Qingji vendored OCR resources

Tesseract.js 6.0.1, Tesseract.js-core 6.0.0.
Chinese Simplified and English fast traineddata from tesseract-ocr/tessdata_fast,
pinned to commit 87416418657359cb625c412a48b6e1d6d41c29bd.

Downloads are performed only by the developer's tools/vendor-ocr.py builder.
No npm install/postinstall scripts are executed.
Runtime paths are self-hosted; the application must not use CDN defaults.
See licenses/ for the original upstream license text and OCR-ASSETS.json for
source URLs, sizes and SHA-256 fingerprints of all delivered resources.

Offline availability requires same-origin HTTPS delivery and a controlling
service worker which serves the OCR cache. Preparing files is not a substitute
for the iPhone airplane-mode test.
