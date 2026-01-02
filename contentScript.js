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

const editableSelector = [
  "textarea",
  "input[type='text']",
  "input[type='search']",
  "[contenteditable='true']",
].join(",");

const shortcutTriggerKeys = new Set([" ", "Enter", "Tab"]);

function normalizeTemplates(templates) {
  templateMap = new Map();
  templates
    .filter((template) => template && template.shortcut && template.content)
    .forEach((template) => {
      templateMap.set(template.shortcut.trim(), template.content);
    });
}

async function loadTemplates() {
  const { templates } = await chrome.storage.sync.get("templates");
  if (!Array.isArray(templates) || templates.length === 0) {
    await chrome.storage.sync.set({ templates: defaultTemplates });
    normalizeTemplates(defaultTemplates);
    return;
  }

  normalizeTemplates(templates);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.templates) {
    return;
  }

  const { newValue } = changes.templates;
  if (Array.isArray(newValue)) {
    normalizeTemplates(newValue);
  }
});

function isEditableTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  if (target.matches("textarea, input[type='text'], input[type='search']")) {
    return target;
  }

  const editable = target.closest("[contenteditable='true']");
  return editable;
}

function getTokenInfoFromText(text) {
  const match = text.match(/(\S+)$/);
  if (!match) {
    return null;
  }

  const token = match[1];
  return {
    token,
    startIndex: text.length - token.length,
  };
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

function createRangeFromOffsets(root, start, end) {
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

function expandInTextarea(element, trailingText) {
  const caretPosition = element.selectionStart;
  if (caretPosition === null || caretPosition === undefined) {
    return false;
  }

  const textBeforeCaret = element.value.slice(0, caretPosition);
  const tokenInfo = getTokenInfoFromText(textBeforeCaret);
  if (!tokenInfo) {
    return false;
  }

  const template = templateMap.get(tokenInfo.token);
  if (!template) {
    return false;
  }

  const start = caretPosition - tokenInfo.token.length;
  const replacement = `${template}${trailingText}`;
  element.setRangeText(replacement, start, caretPosition, "end");
  return true;
}

function expandInContentEditable(element, trailingText) {
  const selection = window.getSelection();
  if (!selection.rangeCount) {
    return false;
  }

  const range = selection.getRangeAt(0);
  if (!element.contains(range.endContainer)) {
    return false;
  }

  const prefixRange = range.cloneRange();
  prefixRange.selectNodeContents(element);
  prefixRange.setEnd(range.endContainer, range.endOffset);
  const textBeforeCaret = prefixRange.toString();
  const tokenInfo = getTokenInfoFromText(textBeforeCaret);
  if (!tokenInfo) {
    return false;
  }

  const template = templateMap.get(tokenInfo.token);
  if (!template) {
    return false;
  }

  const tokenStart = tokenInfo.startIndex;
  const tokenEnd = tokenStart + tokenInfo.token.length;
  const deleteRange = createRangeFromOffsets(element, tokenStart, tokenEnd);
  if (!deleteRange) {
    return false;
  }

  deleteRange.deleteContents();
  selection.removeAllRanges();
  selection.addRange(deleteRange);
  deleteRange.collapse(true);

  insertTextWithLineBreaks(deleteRange, `${template}${trailingText}`);
  return true;
}

function handleShortcutExpansion(event) {
  if (!shortcutTriggerKeys.has(event.key)) {
    return;
  }

  const editableTarget = isEditableTarget(event.target);
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
