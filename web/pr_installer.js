/**
 * ComfyUI-PR-Installer Frontend Extension
 * Toolbar button via the modern `actionBarButtons` API + PR list modal.
 *
 * WHY THE ACTIONBAR REWRITE: the previous version injected a button by
 * searching the DOM for `.comfy-menu`, `button[title='Save']` and
 * `.comfy-button`. Those are OLD-frontend (litegraph) selectors. In the
 * current Vue frontend the top bar is `.comfyui-top-bar`, there is no
 * `.comfy-menu`, no `button[title='Save']`, and buttons carry the class
 * `comfyui-button` (note the extra "ui"). Every selector missed, the code
 * fell through to `document.body.appendChild(btn)`, and the button landed
 * as a stray floating element outside the toolbar. `actionBarButtons` is
 * declarative: ComfyUI renders the button for you, no DOM hunting, no
 * timing/retry, survives frontend re-renders.
 *
 * UI NOTES (this pass): styling moved out of inline `style` attributes and
 * into style.css using ComfyUI's own CSS variables (--comfy-menu-bg,
 * --border-color, etc.) so the panel follows the user's theme instead of a
 * hardcoded dark palette. Event handling moved off global `window.*` +
 * inline `onclick` and onto addEventListener / delegation. Installing or
 * reverting now requires an inline confirmation step first, since both
 * actions check out untested code and can run pip installs against the
 * user's real ComfyUI install.
 */
import { app } from "/scripts/app.js";

const PLUGIN = "ComfyUI.PRInstaller";
const MODAL_ID = "pr-installer-modal";

// ComfyUI auto-loads a custom node's *.js under web/ as extensions, but it
// does NOT auto-link any *.css that lives alongside them — that has to be
// done explicitly, or none of the classes below ever take effect (no
// position:fixed, no display toggle, the modal just renders inline and
// invisibly wherever it landed in the DOM).
function ensureStylesheet() {
  if (document.getElementById("pri-stylesheet")) return;
  const link = document.createElement("link");
  link.id = "pri-stylesheet";
  link.rel = "stylesheet";
  link.href = new URL("./style.css", import.meta.url).href;
  document.head.appendChild(link);
}
ensureStylesheet();

// Full PR list from the last successful fetch, kept around so the search
// box can filter client-side without re-hitting the GitHub-backed endpoint.
let lastPrList = [];
// { kind: 'install', pr: number } | { kind: 'revert' } | null
let pendingAction = null;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildModal() {
  const overlay = document.createElement("div");
  overlay.id = MODAL_ID;
  overlay.className = "pri-overlay";
  overlay.innerHTML = `
    <div class="pri-modal" role="dialog" aria-modal="true" aria-labelledby="pri-title">
      <div class="pri-header">
        <div class="pri-header-text">
          <h2 id="pri-title">ComfyUI Official PR Installer</h2>
          <p>Browse open PRs from <code>comfyanonymous/ComfyUI</code>, install with one click, or revert to stable.</p>
        </div>
        <button type="button" class="pri-close" data-action="close" aria-label="Close">&times;</button>
      </div>

      <div class="pri-body">
        <div class="pri-section">
          <div class="pri-section-label"><strong>Status</strong></div>
          <div id="pri-status" class="pri-status-placeholder">Loading status…</div>
        </div>

        <div class="pri-section">
          <div class="pri-section-label">
            <strong>Open PRs</strong>
            <button type="button" class="pri-btn pri-btn--small" data-action="refresh-list">Refresh</button>
          </div>
          <input
            type="search"
            class="pri-search"
            id="pri-search"
            placeholder="Filter by title, author, or PR #…"
            aria-label="Filter open PRs"
          />
          <div id="pri-list" class="pri-list">
            <div class="pri-loading">Fetching PR list from GitHub…</div>
          </div>
        </div>

        <div class="pri-section">
          <label class="pri-manual-label" for="pri-num">Manual entry (if needed)</label>
          <div class="pri-row">
            <input id="pri-num" class="pri-num" type="number" min="1" max="99999" placeholder="Enter PR # directly" />
            <button type="button" class="pri-btn pri-btn--primary" data-action="install-manual">Install PR</button>
          </div>
        </div>

        <div id="pri-confirm-slot"></div>

        <div class="pri-section pri-actions">
          <button type="button" class="pri-btn pri-btn--danger pri-btn--block" data-action="revert">Revert to Stable</button>
          <button type="button" class="pri-btn pri-btn--block" data-action="refresh-status">Refresh Status</button>
        </div>

        <div class="pri-section-label"><strong>Log</strong></div>
        <div id="pri-log" class="pri-log" role="log" aria-live="polite">
          <div class="pri-log-empty">Logs will appear here.</div>
        </div>
      </div>
    </div>
  `;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay.addEventListener("click", handleModalClick);
  overlay.querySelector("#pri-search").addEventListener("input", handleSearchInput);
  overlay.querySelector("#pri-num").addEventListener("keydown", (e) => {
    if (e.key === "Enter") requestInstall(parseManualPrNumber());
  });

  document.body.appendChild(overlay);
  return overlay;
}

function getModal() {
  return document.getElementById(MODAL_ID) || buildModal();
}

function openModal() {
  const modal = getModal();
  modal.classList.add("is-open");
  document.addEventListener("keydown", handleEscape);
  refreshStatus();
  loadList();
}

function closeModal() {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  modal.classList.remove("is-open");
  document.removeEventListener("keydown", handleEscape);
  clearPendingAction();
}

function handleEscape(e) {
  if (e.key === "Escape") closeModal();
}

// ------------------------------------------------------------------
// Delegated click handling for everything inside the modal
// ------------------------------------------------------------------
function handleModalClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "close") return closeModal();
  if (action === "refresh-status") return refreshStatus();
  if (action === "refresh-list") return loadList();
  if (action === "install-manual") return requestInstall(parseManualPrNumber());
  if (action === "install-pr") return requestInstall(parseInt(btn.dataset.pr, 10));
  if (action === "revert") return requestRevert();
  if (action === "confirm-yes") return runPendingAction();
  if (action === "confirm-no") return clearPendingAction();
}

function parseManualPrNumber() {
  const input = document.getElementById("pri-num");
  const val = parseInt(input?.value, 10);
  return Number.isFinite(val) ? val : NaN;
}

// ------------------------------------------------------------------
// Confirmation step — install/revert both mutate the real install, so
// neither fires directly off a click. This renders a small inline banner
// with an explicit second click required.
// ------------------------------------------------------------------
function requestInstall(prNumber) {
  if (!Number.isFinite(prNumber) || prNumber < 1) {
    appendLog("Enter a valid PR number (> 0).", "error");
    return;
  }
  pendingAction = { kind: "install", pr: prNumber };
  renderConfirm(
    `Install PR #${prNumber}? This checks out untested code and runs pip install against your ComfyUI install. A backup branch is created first.`
  );
}

function requestRevert() {
  pendingAction = { kind: "revert" };
  renderConfirm("Revert to the latest stable tag? This checks out over your current branch.");
}

function renderConfirm(message) {
  const slot = document.getElementById("pri-confirm-slot");
  if (!slot) return;
  slot.innerHTML = `
    <div class="pri-confirm">
      <p>${escapeHtml(message)}</p>
      <div class="pri-confirm-actions">
        <button type="button" class="pri-btn pri-btn--small" data-action="confirm-no">Cancel</button>
        <button type="button" class="pri-btn pri-btn--small pri-btn--primary" data-action="confirm-yes">Confirm</button>
      </div>
    </div>
  `;
}

function clearPendingAction() {
  pendingAction = null;
  const slot = document.getElementById("pri-confirm-slot");
  if (slot) slot.innerHTML = "";
}

function runPendingAction() {
  const action = pendingAction;
  clearPendingAction();
  if (!action) return;
  if (action.kind === "install") return doInstall(action.pr);
  if (action.kind === "revert") return doRevert();
}

// ------------------------------------------------------------------
// Status
// ------------------------------------------------------------------
async function refreshStatus() {
  const box = document.getElementById("pri-status");
  if (!box) return;
  box.innerHTML = '<div class="pri-status-placeholder">Fetching status…</div>';
  try {
    const res = await fetch("/pr-installer/status");
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    box.innerHTML = `
      <dl class="pri-status">
        <dt>Root</dt><dd>${escapeHtml(data.root || "?")}</dd>
        <dt>Git repo</dt><dd>${badge(data.git_repo)}</dd>
        <dt>Origin = ComfyUI</dt><dd>${badge(data.comfy_origin)}</dd>
        <dt>Branch</dt><dd>${escapeHtml(data.branch || "?")}</dd>
        <dt>SHA</dt><dd><code>${escapeHtml(data.sha || "?")}</code></dd>
      </dl>
    `;
  } catch (e) {
    box.innerHTML = '<div class="pri-status-placeholder">Status unavailable. Ensure the ComfyUI server is running.</div>';
    appendLog("Status error: " + e.message, "error");
  }
}

function badge(ok) {
  return ok
    ? '<span class="pri-badge pri-badge--ok">Yes</span>'
    : '<span class="pri-badge pri-badge--bad">No</span>';
}

// ------------------------------------------------------------------
// PR list
// ------------------------------------------------------------------
async function loadList() {
  const listDiv = document.getElementById("pri-list");
  if (!listDiv) return;
  listDiv.innerHTML = '<div class="pri-loading">Fetching PR list from GitHub…</div>';
  try {
    const res = await fetch("/pr-installer/list");
    const data = await res.json();
    if (!res.ok || data.status !== "ok" || !data.pr_list) {
      listDiv.innerHTML = `<div class="pri-error">Failed to load list: ${escapeHtml(data.message || "Unknown error")}</div>`;
      return;
    }
    lastPrList = data.pr_list;
    renderList(lastPrList);
  } catch (e) {
    listDiv.innerHTML = `<div class="pri-error">Error loading list: ${escapeHtml(e.message)}</div>`;
  }
}

function renderList(items) {
  const listDiv = document.getElementById("pri-list");
  if (!listDiv) return;
  if (items.length === 0) {
    listDiv.innerHTML = '<div class="pri-empty">No matching open PRs.</div>';
    return;
  }
  listDiv.innerHTML = items.map(prCardHtml).join("");
}

function prCardHtml(pr) {
  const title = escapeHtml(pr.title || "Untitled");
  const author = escapeHtml(pr.author || "?");
  const state = escapeHtml(pr.state || "?");
  const url = pr.url || "#";
  const bodyRaw = (pr.body || "").trim();
  const bodyText = bodyRaw
    ? escapeHtml(bodyRaw.slice(0, 2000)) + (bodyRaw.length > 2000 ? "\n… (truncated)" : "")
    : "No description provided.";

  return `
    <div class="pri-pr-card">
      <div class="pri-pr-row">
        <button type="button" class="pri-btn pri-btn--primary pri-btn--small" data-action="install-pr" data-pr="${pr.pr_number}">
          Install #${pr.pr_number}
        </button>
        <div class="pri-pr-main">
          <div class="pri-pr-title" title="${title}">${title}</div>
          <div class="pri-pr-meta">by <strong>${author}</strong> · ${state} · <a href="${url}" target="_blank" rel="noopener noreferrer">GitHub ↗</a></div>
        </div>
      </div>
      <details>
        <summary>Description</summary>
        <div class="pri-pr-body">${bodyText}</div>
      </details>
    </div>
  `;
}

function handleSearchInput(e) {
  const q = e.target.value.trim().toLowerCase();
  if (!q) return renderList(lastPrList);
  const filtered = lastPrList.filter((pr) => {
    return (
      String(pr.pr_number).includes(q) ||
      (pr.title || "").toLowerCase().includes(q) ||
      (pr.author || "").toLowerCase().includes(q)
    );
  });
  renderList(filtered);
}

// ------------------------------------------------------------------
// Install / revert (actual network calls — only reached after confirm)
// ------------------------------------------------------------------
async function doInstall(prNumber) {
  const buttons = disableActionButtons();
  appendLog(`Starting install for PR #${prNumber}…`, "info");
  try {
    const res = await fetch("/pr-installer/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pr: prNumber }),
    });
    const data = await res.json();
    if (res.ok && data.status === "ok") {
      appendLog(data.message, "success");
      appendLog("Dependencies: " + (data.dependencies || "N/A"), "info");
      refreshStatus();
    } else {
      appendLog(data.message || `Install failed (HTTP ${res.status})`, "error");
    }
  } catch (e) {
    appendLog("Install request failed: " + e.message, "error");
  } finally {
    enableActionButtons(buttons);
  }
}

async function doRevert() {
  const buttons = disableActionButtons();
  appendLog("Reverting to stable / latest release tag…", "info");
  try {
    const res = await fetch("/pr-installer/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "stable" }),
    });
    const data = await res.json();
    if (res.ok && data.status === "ok") {
      appendLog(data.message, "success");
      refreshStatus();
    } else {
      appendLog(data.message || `Revert failed (HTTP ${res.status})`, "error");
    }
  } catch (e) {
    appendLog("Revert request failed: " + e.message, "error");
  } finally {
    enableActionButtons(buttons);
  }
}

function disableActionButtons() {
  const modal = document.getElementById(MODAL_ID);
  const buttons = modal ? [...modal.querySelectorAll("[data-action]")] : [];
  buttons.forEach((b) => (b.disabled = true));
  return buttons;
}

function enableActionButtons(buttons) {
  buttons.forEach((b) => (b.disabled = false));
}

// ------------------------------------------------------------------
// Log
// ------------------------------------------------------------------
function appendLog(msg, level = "info") {
  const log = document.getElementById("pri-log");
  if (!log) return;
  const empty = log.querySelector(".pri-log-empty");
  if (empty) empty.remove();
  const line = document.createElement("div");
  line.className = `pri-log-line pri-log-line--${level}`;
  const time = document.createElement("span");
  time.className = "pri-log-time";
  time.textContent = new Date().toLocaleTimeString();
  line.appendChild(time);
  line.appendChild(document.createTextNode(msg));
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// ------------------------------------------------------------------
// Registration
// ------------------------------------------------------------------
function openInstaller() {
  openModal();
}

app.registerExtension({
  name: PLUGIN,

  // The modern, supported way to put a button in the top action bar.
  // ComfyUI owns the rendering; the button survives frontend re-renders.
  actionBarButtons: [
    {
      icon: "icon-[lucide--git-pull-request]", // lucide iconify class; falls back to empty icon, label still shows
      label: "PR Installer",
      tooltip: "Browse and install official ComfyUI PRs",
      class: "pr-installer-btn",
      onClick: () => openInstaller(),
    },
  ],

  // Keep the feature reachable even if the button is hidden / frontend differs:
  // palette entry + Alt+P shortcut, independent of the DOM.
  commands: [
    {
      id: "PRInstaller.Open",
      label: "Open PR Installer",
      icon: "icon-[lucide--git-pull-request]",
      function: () => openInstaller(),
    },
  ],
  keybindings: [{ combo: { key: "p", alt: true }, commandId: "PRInstaller.Open" }],
});
