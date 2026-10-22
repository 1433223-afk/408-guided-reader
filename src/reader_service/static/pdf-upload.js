const MAX_PDF_BYTES = 2 * 1024 * 1024 * 1024;
const READ_CHUNK_BYTES = 4 * 1024 * 1024;

function readChunk(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`无法读取所选文件（${reader.error?.name || '读取失败'}）。请重新选择平板内部存储中的 PDF。`));
    reader.onabort = () => reject(new Error('文件读取已中断，请重新选择 PDF。'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function preparePdfUpload(file, onProgress = () => {}) {
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error('所选文件为空或无法读取大小，请重新选择内部存储中的 PDF。');
  }
  if (file.size > MAX_PDF_BYTES) throw new Error('PDF 超过 2 GiB 导入上限，请选择较小的文件。');
  onProgress({phase:'reading', loaded:0, total:file.size});
  const parts = [];
  // Android document providers can change the backing file's metadata after
  // selection. Read bounded chunks into browser-owned Blobs before transport,
  // rather than letting the network reread the original File later.
  for (let offset = 0; offset < file.size; offset += READ_CHUNK_BYTES) {
    const end = Math.min(file.size, offset + READ_CHUNK_BYTES);
    const bytes = await readChunk(file.slice(offset, end));
    if (bytes.byteLength !== end - offset) throw new Error('文件没有读取完整，请重新选择 PDF 后重试。');
    parts.push(new Blob([bytes]));
    onProgress({phase:'reading', loaded:end, total:file.size});
  }
  // The Core validates PDF contents. Android MIME and filename suffixes are
  // hints, so a valid PDF without either must still reach that validation.
  return new Blob(parts, {type:'application/pdf'});
}

function responseError(xhr, payload, local = false) {
  const status = xhr.status;
  const id = xhr.getResponseHeader('X-Reader-Upload-Id');
  let reason = payload?.error || `服务返回 HTTP ${status}`;
  if (status === 401) reason = local ? '本机阅读会话已失效，请从应用菜单重新打开书库后再导入。'
    : '当前启动凭证已失效，请使用电脑本次启动的完整地址重新打开后再导入。';
  else if (status === 403) reason = local ? '本机 Reader 拒绝了导入，请从应用菜单重新打开后重试。'
    : '服务拒绝了上传，请使用电脑提供的本次局域网启动地址重新打开。';
  else if (payload?.code === 'INVALID_PDF') {
    if (reason === 'The selected file does not have a PDF header') reason = '所选文件不是有效 PDF，未找到 PDF 文件头。';
    else if (reason === 'The PDF is incomplete (missing end marker)') reason = 'PDF 文件不完整，请重新下载完整文件后再导入。';
    else if (reason === 'Encrypted or password-protected PDFs are not supported') reason = '此 PDF 需要密码或已加密，暂不支持导入。';
  }
  const error = new Error(`${reason}（HTTP ${status}${payload?.code ? ` · ${payload.code}` : ''}${id ? ` · 编号 ${id}` : ''}）`);
  error.status = status;
  error.code = payload?.code;
  error.uploadId = id;
  return error;
}

export function uploadPdf({body, filename, bookId = null, token, onProgress = () => {}, local = false}) {
  return new Promise((resolve, reject) => {
    const parameters = new URLSearchParams();
    if (bookId) parameters.set('book_id', bookId);
    const query = parameters.toString();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/books${query ? `?${query}` : ''}`);
    xhr.withCredentials = true;
    xhr.timeout = 15 * 60 * 1000;
    if (token) xhr.setRequestHeader('X-Reader-Token', token);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(filename || 'book.pdf'));
    xhr.setRequestHeader('Content-Type', 'application/pdf');
    onProgress({phase:'uploading', loaded:0, total:body.size});
    xhr.upload.onprogress = event => onProgress({phase:'uploading', loaded:event.loaded, total:event.lengthComputable ? event.total : body.size});
    xhr.upload.onload = () => onProgress({phase:'validating'});
    xhr.onload = () => {
      let payload;
      try {payload = JSON.parse(xhr.responseText);} catch (_) { /* Report the actual HTTP status below. */ }
      if (xhr.status < 200 || xhr.status >= 300) {reject(responseError(xhr, payload, local)); return;}
      if (!payload?.book?.active_revision) {reject(new Error('服务已响应，但未返回完整书籍信息；请刷新书库确认后重试。')); return;}
      resolve(payload);
    };
    xhr.onerror = () => reject(new Error(local
      ? '本机导入中断，未收到 Reader 响应。请从应用菜单重新打开书库后重试。'
      : '上传连接中断，未收到 Reader Core 响应。请确认电脑服务仍在运行、两端仍连接同一 Wi-Fi，再重新选择 PDF。'));
    xhr.ontimeout = () => reject(new Error(local ? '导入等待超过 15 分钟，请先重新打开书库确认是否已入库，再重试。'
      : '上传等待超过 15 分钟，请先刷新书库确认是否已入库，再重试。'));
    xhr.onabort = () => reject(new Error(local ? 'PDF 导入已中断，请重新选择文件。' : 'PDF 上传已中断，请重新选择文件。'));
    // The browser supplies Content-Length for this known-size Blob. Keep the
    // existing raw-PDF contract; FormData would corrupt that request body.
    xhr.send(body);
  });
}
