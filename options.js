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

const templatesContainer = document.getElementById("templates");
const addButton = document.getElementById("add-template");
const saveButton = document.getElementById("save");
const resetButton = document.getElementById("reset");
const statusLabel = document.getElementById("status");

function createTemplateRow(template = {}) {
  const row = document.createElement("div");
  row.className = "template";

  const shortcutWrapper = document.createElement("div");
  const shortcutLabel = document.createElement("label");
  shortcutLabel.textContent = "Shortcut";
  const shortcutInput = document.createElement("input");
  shortcutInput.type = "text";
  shortcutInput.placeholder = "#followup";
  shortcutInput.value = template.shortcut || "";

  shortcutWrapper.appendChild(shortcutLabel);
  shortcutWrapper.appendChild(shortcutInput);

  const contentWrapper = document.createElement("div");
  const contentLabel = document.createElement("label");
  contentLabel.textContent = "Message";
  const contentInput = document.createElement("textarea");
  contentInput.placeholder = "Full reply to insert";
  contentInput.value = template.content || "";

  contentWrapper.appendChild(contentLabel);
  contentWrapper.appendChild(contentInput);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "remove";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => row.remove());

  row.appendChild(shortcutWrapper);
  row.appendChild(contentWrapper);
  row.appendChild(removeButton);

  return row;
}

function renderTemplates(templates) {
  templatesContainer.innerHTML = "";
  templates.forEach((template) => {
    templatesContainer.appendChild(createTemplateRow(template));
  });
}

function collectTemplates() {
  return Array.from(templatesContainer.querySelectorAll(".template"))
    .map((row) => {
      const [shortcutInput, contentInput] = row.querySelectorAll("input, textarea");
      return {
        shortcut: shortcutInput.value.trim(),
        content: contentInput.value.trim(),
      };
    })
    .filter((template) => template.shortcut && template.content);
}

function setStatus(message) {
  statusLabel.textContent = message;
  if (message) {
    setTimeout(() => {
      statusLabel.textContent = "";
    }, 2000);
  }
}

async function saveTemplates() {
  const templates = collectTemplates();
  await chrome.storage.sync.set({ templates });
  setStatus("Saved!");
}

async function loadTemplates() {
  const { templates } = await chrome.storage.sync.get("templates");
  if (!Array.isArray(templates) || templates.length === 0) {
    await chrome.storage.sync.set({ templates: defaultTemplates });
    renderTemplates(defaultTemplates);
    return;
  }

  renderTemplates(templates);
}

addButton.addEventListener("click", () => {
  templatesContainer.appendChild(createTemplateRow());
});

saveButton.addEventListener("click", saveTemplates);

resetButton.addEventListener("click", async () => {
  await chrome.storage.sync.set({ templates: defaultTemplates });
  renderTemplates(defaultTemplates);
  setStatus("Defaults restored");
});

loadTemplates();
