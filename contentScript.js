const defaultTemplates = [
  {
    shortcut: "#followup",
    content:
      "Hi there,\n\nJust following up on my previous note. Let me know if you have any questions or if there's anything else you need from me.\n\nThanks!",
  },
  {
    shortcut: "#status",
    content:
      "Hi team,\n\nQuick status update: the current task is in progress and I'm on track to share the next milestone soon. I'll send another update once it's ready.\n\nBest,",
  },
  {
    shortcut: "#intro",
    content:
      "Hi [Name],\n\nI'd like to introduce you to [Name]. You both are working on similar projects and I think a quick connection could be helpful.\n\nThanks!",
  },
];

let templateMap = new Map();
const gmailHost = location.hostname === "mail.google.com";

const shortcutTriggerKeys = new Set([" ", "Enter", "Tab"]);
const trailingPunctuation = /[,.!?:;\)\]}"]*$/;
const leadingPunctuation = /^[\(\[\{"']*/;

function normalizeTemplates(templates) {
  templateMap = new Map();
  templates
    .filter((template) => template && template.shortcut && template.content)
    .forEach((template) => {
      templateMap.set(template.shortcut.trim(), template.content);
    });
}

async function getTemplatesFromStorage() {
  try {
    const { templates } = await chrome.storage.sync.get("templates");
    if (Array.isArray(templates) && templates.length) {
      return templates;
    }
  } catch (error) {
    // Fall back to local storage when sync is unavailable.
  }

  const { templates: localTemplates } = await chrome.storage.local.get("templates");
  if (Array.isArray(localTemplates) && localTemplates.length) {
    return localTemplates;
  }

  return null;
}

async function persistTemplates(templates) {
  try {
    await chrome.storage.sync.set({ templates });
    await chrome.storage.local.remove("templates");
    return "sync";
  } catch (error) {
    await chrome.storage.local.set({ templates });
    return "local";
  }
}

async function loadTemplates() {
  const templates = await getTemplatesFromStorage();
  if (!Array.isArray(templates) || templates.length === 0) {
    await persistTemplates(defaultTemplates);
    normalizeTemplates(defaultTemplates);
    return;
  }

  normalizeTemplates(templates);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName !== "sync" && areaName !== "local") || !changes.templates) {
    return;
  }

  const { newValue } = changes.templates;
  if (Array.isArray(newValue)) {
    normalizeTemplates(newValue);
  }
});

function getEditableTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  if (target.matches("textarea, input[type='text'], input[type='search']")) {
    return target;
  }

  const editable = target.closest("[contenteditable='true']");
  if (!editable) {
    return null;
  }

  if (gmailHost) {
    return editable.closest("[role='textbox'][contenteditable='true']");
  }

  return editable;
}

function parseToken(rawToken) {
  if (!rawToken) {
    return null;
  }

  const leadingMatch = rawToken.match(leadingPunctuation);
  const leading = leadingMatch ? leadingMatch[0] : "";
  const trailingMatch = rawToken.match(trailingPunctuation);
  const trailing = trailingMatch ? trailingMatch[0] : "";
  const core = rawToken.slice(leading.length, rawToken.length - trailing.length);

  if (!core) {
    return null;
  }

  return { leading, core, trailing };
}

function getRawTokenFromText(text) {
  const match = text.match(/(\S+)$/);
  if (!match) {
    return null;
  }

  const rawToken = match[1];
  return {
    rawToken,
    startIndex: text.length - rawToken.length,
  };
}

function createRangeFromOffsetsWithin(root, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let currentNode = null;
  let currentOffset = 0;
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;

  while ((currentNode = walker.nextNode())) {
    const nodeLength = currentNode.textContent.length;

    if (startNode === null && currentOffset + nodeLength >= start) {
      startNode = currentNode;
      startOffset = start - currentOffset;
    }

    if (currentOffset + nodeLength >= end) {
      endNode = currentNode;
      endOffset = end - currentOffset;
      break;
    }

    currentOffset += nodeLength;
  }

  if (!startNode || !endNode) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function findTextBlock(root, range) {
  let element = range.endContainer.nodeType === Node.ELEMENT_NODE
    ? range.endContainer
    : range.endContainer.parentElement;

  while (element && element !== root) {
    if (element.matches("div, p, li, blockquote")) {
      return element;
    }
    element = element.parentElement;
  }

  return root;
}

function insertTextWithLineBreaks(range, text) {
  const fragment = document.createDocumentFragment();
  const parts = text.split("\n");
  let lastNode = null;

  parts.forEach((part, index) => {
    if (part.length) {
      lastNode = document.createTextNode(part);
      fragment.appendChild(lastNode);
    }

    if (index < parts.length - 1) {
      lastNode = document.createElement("br");
      fragment.appendChild(lastNode);
    }
  });

  range.insertNode(fragment);

  if (lastNode) {
    range.setStartAfter(lastNode);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function expandInTextarea(element, trailingText) {
  const caretPosition = element.selectionStart;
  if (caretPosition === null || caretPosition === undefined) {
    return false;
  }

  const textBeforeCaret = element.value.slice(0, caretPosition);
  const tokenInfo = getRawTokenFromText(textBeforeCaret);
  if (!tokenInfo) {
    return false;
  }

  const tokenParts = parseToken(tokenInfo.rawToken);
  if (!tokenParts) {
    return false;
  }

  const template = templateMap.get(tokenParts.core);
  if (!template) {
    return false;
  }

  const start = caretPosition - tokenInfo.rawToken.length;
  const replacement = `${tokenParts.leading}${template}${tokenParts.trailing}${trailingText}`;
  element.setRangeText(replacement, start, caretPosition, "end");
  return true;
}

function expandInContentEditable(element, trailingText) {
  const selection = window.getSelection();
  if (!selection.rangeCount) {
    return false;
  }

  const range = selection.getRangeAt(0);
  if (!range.collapsed || !element.contains(range.endContainer)) {
    return false;
  }

  const textBlock = findTextBlock(element, range);
  const prefixRange = range.cloneRange();
  prefixRange.setStart(textBlock, 0);

  const textBeforeCaret = prefixRange.toString();
  const tokenInfo = getRawTokenFromText(textBeforeCaret);
  if (!tokenInfo) {
    return false;
  }

  const tokenParts = parseToken(tokenInfo.rawToken);
  if (!tokenParts) {
    return false;
  }

  const template = templateMap.get(tokenParts.core);
  if (!template) {
    return false;
  }

  // Build a local replacement range scoped to the current text block for Gmail stability.
  const tokenStart = textBeforeCaret.length - tokenInfo.rawToken.length;
  const tokenEnd = textBeforeCaret.length;
  const replaceRange = createRangeFromOffsetsWithin(textBlock, tokenStart, tokenEnd);
  if (!replaceRange) {
    return false;
  }

  replaceRange.deleteContents();
  selection.removeAllRanges();
  selection.addRange(replaceRange);
  replaceRange.collapse(true);

  const replacement = `${tokenParts.leading}${template}${tokenParts.trailing}${trailingText}`;
  insertTextWithLineBreaks(replaceRange, replacement);
  return true;
}

function handleShortcutExpansion(event) {
  if (!shortcutTriggerKeys.has(event.key)) {
    return;
  }

  const editableTarget = getEditableTarget(event.target);
  if (!editableTarget || templateMap.size === 0) {
    return;
  }

  const trailingText = event.key === "Enter" ? "\n" : " ";
  const wasExpanded = editableTarget.matches("textarea, input[type='text'], input[type='search']")
    ? expandInTextarea(editableTarget, trailingText)
    : expandInContentEditable(editableTarget, trailingText);

  if (wasExpanded) {
    event.preventDefault();
  }
}

document.addEventListener("keydown", handleShortcutExpansion, true);
loadTemplates();
