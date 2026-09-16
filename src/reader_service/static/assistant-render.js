import { marked } from "/vendor/marked.esm.js";
import createDOMPurify from "/vendor/purify.es.mjs";
import katex from "/vendor/katex.mjs";

const MAX_RENDER_CHARS = 50_000;
const MAX_MATH_SEGMENTS = 64;
const MAX_TEX_CHARS = 4_000;
const purifier = createDOMPurify(window);

const renderer = new marked.Renderer();
renderer.html = ({ text }) => escapeHtml(text);
renderer.link = function link({ tokens }) {
  return this.parser.parseInline(tokens);
};
renderer.image = ({ text }) => escapeHtml(text || "");

marked.setOptions({
  async: false,
  breaks: false,
  gfm: true,
  renderer,
});

export function renderAssistantAnswer(element, rawAnswer) {
  const raw = String(rawAnswer ?? "");
  const bounded = Array.from(raw).slice(0, MAX_RENDER_CHARS).join("");
  const prepared = prepareMarkdownAndMath(bounded);
  const parsed = marked.parse(prepared.markdown);
  const template = document.createElement("template");
  template.innerHTML = parsed;
  replaceMathPlaceholders(template.content, prepared.math);
  const clean = purifier.sanitize(template.content, {
    RETURN_DOM_FRAGMENT: true,
    ALLOW_DATA_ATTR: true,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "img", "a"],
    FORBID_ATTR: ["href", "src", "srcset"],
  });
  annotateSourceText(clean, bounded);
  element.replaceChildren(clean);
  if (Array.from(raw).length > MAX_RENDER_CHARS) {
    const notice = document.createElement("p");
    notice.className = "assistant-render-limit";
    notice.textContent = "回答过长，已限制本次渲染范围。";
    element.append(notice);
  }
}

export function renderedSelectionToRaw(range, answerElement) {
  if (!range || !answerElement || !answerElement.contains(range.commonAncestorContainer)) {
    return null;
  }
  const blocked = answerElement.querySelectorAll("[data-assistant-unselectable='true']");
  if (Array.from(blocked).some((element) => range.intersectsNode(element))) {
    return { blocked: true, reason: "当前暂不支持直接选择公式或代码继续解释。" };
  }
  const mapped = Array.from(answerElement.querySelectorAll(".assistant-source-text"))
    .filter((element) => range.intersectsNode(element))
    .map((element) => selectedMappedPart(range, element))
    .filter((part) => part && part.text.length > 0);
  if (mapped.length === 0) return null;
  trimMappedParts(mapped);
  const selectedText = mapped.map((part) => part.text).join("");
  if (!selectedText || selectedText.trim() !== selectedText) return null;
  const visible = range.toString().trim();
  if (visible.replace(/\s+/g, "") !== selectedText.replace(/\s+/g, "")) return null;
  return {
    blocked: false,
    selectedText,
    sourceSpans: mapped.map((part) => ({ start: part.rawStart, end: part.rawEnd })),
    startOffset: mapped[0].rawStart,
    endOffset: mapped.at(-1).rawEnd,
  };
}

export function prepareMarkdownAndMath(raw) {
  const nonce = `ASSISTANT_${crypto.randomUUID().replaceAll("-", "")}`;
  const code = [];
  const math = [];
  let protectedText = "";
  let index = 0;
  while (index < raw.length) {
    const codeToken = codeAt(raw, index);
    if (codeToken) {
      const placeholder = `${nonce}_CODE_${code.length}_END`;
      code.push({ placeholder, source: raw.slice(index, codeToken.end) });
      protectedText += placeholder;
      index = codeToken.end;
      continue;
    }
    const mathToken = math.length < MAX_MATH_SEGMENTS ? mathAt(raw, index) : null;
    if (mathToken && Array.from(mathToken.tex).length <= MAX_TEX_CHARS) {
      const placeholder = `${nonce}_MATH_${math.length}_END`;
      math.push({
        placeholder,
        tex: mathToken.tex,
        display: mathToken.display,
        rawStart: codePointLength(raw.slice(0, index)),
        rawEnd: codePointLength(raw.slice(0, mathToken.end)),
      });
      protectedText += placeholder;
      index = mathToken.end;
      continue;
    }
    protectedText += raw[index];
    index += 1;
  }
  let markdown = escapeHtml(protectedText);
  for (const token of code) markdown = markdown.replaceAll(token.placeholder, token.source);
  return { markdown, math };
}

function codeAt(raw, start) {
  if (raw.startsWith("```", start)) {
    const closing = raw.indexOf("```", start + 3);
    return { end: closing < 0 ? raw.length : closing + 3 };
  }
  if (raw[start] !== "`") return null;
  let ticks = 1;
  while (raw[start + ticks] === "`") ticks += 1;
  const delimiter = "`".repeat(ticks);
  const closing = raw.indexOf(delimiter, start + ticks);
  return closing < 0 ? null : { end: closing + ticks };
}

function mathAt(raw, start) {
  if (raw.startsWith("$$", start) && !isEscaped(raw, start)) {
    const closing = findUnescaped(raw, "$$", start + 2);
    if (closing >= 0) return {
      tex: raw.slice(start + 2, closing).trim(), display: true, end: closing + 2,
    };
  }
  for (const [open, close, display] of [["\\[", "\\]", true], ["\\(", "\\)", false]]) {
    if (!raw.startsWith(open, start) || isEscaped(raw, start)) continue;
    const closing = findUnescaped(raw, close, start + open.length);
    if (closing >= 0) return {
      tex: raw.slice(start + open.length, closing).trim(),
      display,
      end: closing + close.length,
    };
  }
  if (raw[start] === "$" && raw[start + 1] !== "$" && !isEscaped(raw, start)) {
    const closing = findUnescaped(raw, "$", start + 1, true);
    if (closing >= 0) return {
      tex: raw.slice(start + 1, closing).trim(), display: false, end: closing + 1,
    };
  }
  return null;
}

function findUnescaped(raw, delimiter, start, stopAtNewline = false) {
  let cursor = start;
  while (cursor < raw.length) {
    if (stopAtNewline && raw[cursor] === "\n") return -1;
    const found = raw.indexOf(delimiter, cursor);
    if (found < 0 || (stopAtNewline && raw.slice(cursor, found).includes("\n"))) return -1;
    if (!isEscaped(raw, found)) return found;
    cursor = found + delimiter.length;
  }
  return -1;
}

function isEscaped(raw, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && raw[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function replaceMathPlaceholders(root, mathTokens) {
  const textNodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const textNode of textNodes) {
    const token = mathTokens.find((candidate) => textNode.data.includes(candidate.placeholder));
    if (!token) continue;
    const fragment = document.createDocumentFragment();
    let remaining = textNode.data;
    while (remaining.length > 0) {
      const next = mathTokens
        .map((candidate) => ({ candidate, index: remaining.indexOf(candidate.placeholder) }))
        .filter((entry) => entry.index >= 0)
        .sort((left, right) => left.index - right.index)[0];
      if (!next) {
        fragment.append(document.createTextNode(remaining));
        break;
      }
      if (next.index > 0) fragment.append(document.createTextNode(remaining.slice(0, next.index)));
      fragment.append(renderMath(next.candidate));
      remaining = remaining.slice(next.index + next.candidate.placeholder.length);
    }
    textNode.replaceWith(fragment);
  }
}

function renderMath(token) {
  const wrapper = document.createElement("span");
  wrapper.className = token.display ? "assistant-math assistant-math-block" : "assistant-math";
  wrapper.dataset.assistantMath = "true";
  wrapper.dataset.assistantUnselectable = "true";
  wrapper.dataset.assistantRawStart = String(token.rawStart);
  wrapper.dataset.assistantRawEnd = String(token.rawEnd);
  wrapper.innerHTML = katex.renderToString(token.tex, {
    displayMode: token.display,
    throwOnError: false,
    trust: false,
    strict: "warn",
    maxExpand: 1_000,
    maxSize: 20,
    output: "html",
  });
  return wrapper;
}

function annotateSourceText(root, raw) {
  const rawCharacters = Array.from(raw);
  let cursor = 0;
  function visit(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.dataset.assistantMath === "true") {
        cursor = Math.max(cursor, Number(node.dataset.assistantRawEnd));
        return;
      }
      if (node.matches("pre, code")) {
        node.dataset.assistantUnselectable = "true";
        const found = findCharacters(rawCharacters, Array.from(node.textContent), cursor);
        if (found >= 0) cursor = found + Array.from(node.textContent).length;
        return;
      }
    }
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.data || /^\s+$/.test(node.data)) return;
      const textCharacters = Array.from(node.data);
      const found = findCharacters(rawCharacters, textCharacters, cursor);
      if (found < 0) return;
      const span = document.createElement("span");
      span.className = "assistant-source-text";
      span.dataset.assistantSourceStart = String(found);
      span.dataset.assistantSourceEnd = String(found + textCharacters.length);
      node.replaceWith(span);
      span.append(node);
      cursor = found + textCharacters.length;
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  }
  visit(root);
}

function selectedMappedPart(range, element) {
  const textNode = element.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
  const characters = Array.from(textNode.data);
  let start = 0;
  let end = characters.length;
  if (element.contains(range.startContainer)) {
    start = pointOffsetWithinText(textNode, range.startContainer, range.startOffset);
  }
  if (element.contains(range.endContainer)) {
    end = pointOffsetWithinText(textNode, range.endContainer, range.endOffset);
  }
  if (end <= start) return null;
  const rawBase = Number(element.dataset.assistantSourceStart);
  return {
    text: characters.slice(start, end).join(""),
    rawStart: rawBase + start,
    rawEnd: rawBase + end,
  };
}

function pointOffsetWithinText(textNode, container, offset) {
  if (container === textNode) return codePointLength(textNode.data.slice(0, offset));
  if (container === textNode.parentElement) return offset === 0 ? 0 : Array.from(textNode.data).length;
  return 0;
}

function trimMappedParts(parts) {
  while (parts.length && !parts[0].text.trim()) parts.shift();
  while (parts.length && !parts.at(-1).text.trim()) parts.pop();
  if (!parts.length) return;
  const leading = parts[0].text.length - parts[0].text.trimStart().length;
  const trailing = parts.at(-1).text.length - parts.at(-1).text.trimEnd().length;
  if (leading) {
    const count = codePointLength(parts[0].text.slice(0, leading));
    parts[0].text = parts[0].text.trimStart();
    parts[0].rawStart += count;
  }
  if (trailing) {
    const count = codePointLength(parts.at(-1).text.slice(-trailing));
    parts.at(-1).text = parts.at(-1).text.trimEnd();
    parts.at(-1).rawEnd -= count;
  }
}

function findCharacters(source, target, start) {
  if (target.length === 0) return start;
  outer: for (let index = start; index <= source.length - target.length; index += 1) {
    for (let offset = 0; offset < target.length; offset += 1) {
      if (source[index + offset] !== target[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function codePointLength(value) {
  return Array.from(value).length;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
