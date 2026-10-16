export async function copyText(text, { clipboard = globalThis.navigator?.clipboard, document = globalThis.document } = {}) {
  if (typeof clipboard?.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return;
    } catch (_error) {
      // Permission policies can block the Clipboard API even on HTTPS.
    }
  }
  const previousFocus = document.activeElement;
  const selection = document.getSelection();
  const ranges = Array.from({ length: selection?.rangeCount || 0 }, (_, index) => selection.getRangeAt(index).cloneRange());
  const input = document.createElement("textarea");
  input.value = text;
  input.readOnly = true;
  input.style.cssText = "position:fixed;left:0;top:0;opacity:0;pointer-events:none;font-size:16px";
  input.setAttribute("aria-hidden", "true");
  document.body.append(input);
  try {
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, text.length);
    if (!document.execCommand("copy")) throw new Error("Copy is unavailable");
  } finally {
    input.remove();
    previousFocus?.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}
