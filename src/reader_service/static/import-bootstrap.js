// This small classic script keeps file selection from silently doing nothing
// if an older Android browser cannot start the main module/dependencies.
(function () {
  var ready = false;
  var selectedBeforeReady = false;
  var input = document.getElementById('import-input');
  var feedback = document.getElementById('import-feedback');
  var message = document.getElementById('import-message');
  var progress = document.getElementById('import-progress');
  function failed() {
    if (ready) return;
    feedback.hidden = false;
    feedback.classList.add('error');
    feedback.setAttribute('role', 'alert');
    feedback.setAttribute('data-phase', 'startup-error');
    message.textContent = new URLSearchParams(location.search).get('local') === '1'
      ? '本机阅读器尚未就绪，暂时无法导入。请从应用菜单重新打开书库后重试。'
      : '阅读器尚未启动，无法上传。请刷新；若仍出现此提示，请使用最新版 Chrome 或联想浏览器重新打开本次启动地址。';
    progress.hidden = true;
  }
  var timer = setTimeout(failed, 15000);
  window.readerIntakeBootFailed = failed;
  window.readerIntakeDidStart = function () {
    ready = true;
    clearTimeout(timer);
    if (selectedBeforeReady) {
      feedback.hidden = false;
      feedback.classList.remove('error');
      feedback.setAttribute('role', 'status');
      feedback.setAttribute('data-phase', 'ready');
      message.textContent = '阅读器已就绪，请重新选择刚才的 PDF。';
    } else if (feedback.getAttribute('data-phase') === 'startup-error') feedback.hidden = true;
  };
  input.addEventListener('change', function () {
    if (!ready && input.files && input.files.length) {selectedBeforeReady = true; failed(); input.value = '';}
  });
  window.addEventListener('error', failed);
  window.addEventListener('unhandledrejection', failed);
}());
