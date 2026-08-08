/**
 * ComfyUI-PR-Installer front-end (sidebar-tab version, no top-bar button).
 * - registerSidebarTab({ type:"custom", render }) builds the panel once
 * - Alt+P (or the sidebar tab) opens it; the toolbar button was removed by request
 * - all features preserved: delegation, pri- classes, confirm banner, search,
 *   details, badges, escapeHtml, keyboard, in-flight disable
 */
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const EXT_ID = "ComfyUI.PRInstaller";
const SIDEBAR_ID = "pri-installer";
const CSS_ID = "pri-styles";

let panelEl = null;
let pendingAction = null;
let currentData = [];

function ensureStylesheet() {
  if (document.getElementById(CSS_ID)) return;
  const link = document.createElement("link");
  link.id = CSS_ID;
  link.rel = "stylesheet";
  link.href = new URL("./style.css", import.meta.url).href;
  document.head.appendChild(link);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function setBusy(busy) {
  panelEl?.querySelectorAll(
    "[data-action='install'],[data-action='install-manual'],[data-action='revert'],[data-action='confirm']"
  ).forEach((b) => { b.disabled = busy; });
}

function log(msg) {
  const el = panelEl?.querySelector(".pri-log");
  if (!el) return;
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

async function refreshStatus() {
  const box = panelEl?.querySelector(".pri-status");
  if (!box) return;
  box.innerHTML = "Fetching status...";
  try {
    const r = await api.fetchApi("/pr-installer/status");
    const d = await r.json();
    const badge = (ok) => ok
      ? `<span class="pri-badge pri-badge-ok">yes</span>`
      : `<span class="pri-badge pri-badge-bad">no</span>`;
    box.innerHTML = `
      <div><span class="pri-k">Root:</span> ${escapeHtml(d.root || "?")}</div>
      <div><span class="pri-k">Git repo:</span> ${badge(d.git_repo)}</div>
      <div><span class="pri-k">Origin = ComfyUI:</span> ${badge(d.comfy_origin)}</div>
      <div><span class="pri-k">Branch:</span> ${escapeHtml(d.branch || "?")}</div>
      <div><span class="pri-k">SHA:</span> <code>${escapeHtml(d.sha || "?")}</code></div>`;
  } catch (e) {
    box.innerHTML = `<div class="pri-badge pri-badge-bad">status unavailable</div>`;
    log("Status error: " + e.message);
  }
}

async function loadList() {
  const listEl = panelEl?.querySelector(".pri-list");
  if (!listEl) return;
  listEl.innerHTML = "Fetching PR list...";
  try {
    const r = await api.fetchApi("/pr-installer/list");
    const d = await r.json();
    if (d.status !== "ok" || !d.pr_list) {
      listEl.innerHTML = `<div class="pri-badge pri-badge-bad">${escapeHtml(d.message || "Failed")}</div>`;
      return;
    }
    currentData = d.pr_list;
    renderList("");
  } catch (e) {
    listEl.innerHTML = `<div class="pri-badge pri-badge-bad">Error: ${escapeHtml(e.message)}</div>`;
  }
}

function renderList(filter) {
  const listEl = panelEl?.querySelector(".pri-list");
  if (!listEl) return;
  const f = (filter || "").trim().toLowerCase();
  const items = (currentData || []).filter((p) =>
    !f ||
    (p.title || "").toLowerCase().includes(f) ||
    (p.author || "").toLowerCase().includes(f) ||
    String(p.pr_number).includes(f));
  if (!items.length) {
    listEl.innerHTML = `<div class="pri-empty">No matching PRs.</div>`;
    return;
  }
  listEl.innerHTML = items.map((p) => `
    <div class="pri-card" data-pr="${p.pr_number}">
      <div class="pri-card-head">
        <button class="pri-btn pri-btn-primary" data-action="install" data-pr="${p.pr_number}">Install #${p.pr_number}</button>
        <div class="pri-card-title">${escapeHtml(p.title)}</div>
      </div>
      <div class="pri-card-meta">by <strong>${escapeHtml(p.author || "?")}</strong> &middot; ${escapeHtml(p.state || "?")} &middot; <a href="${escapeHtml(p.url || "#")}" target="_blank" class="pri-link">GitHub &rarr;</a></div>
      <details class="pri-details"><summary>Description</summary><div class="pri-card-body">${escapeHtml(p.body || "")}</div></details>
    </div>`).join("");
}

async function doInstall(pr) {
  setBusy(true);
  try {
    log(`Starting install for PR #${pr}...`);
    const r = await api.fetchApi("/pr-installer/install", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pr }),
    });
    const d = await r.json();
    if (d.status === "ok") {
      log("SUCCESS: " + d.message);
      log("Dependencies: " + (d.dependencies || "n/a"));
    } else {
      log("ERROR: " + (d.message || "unknown"));
    }
    refreshStatus();
  } catch (e) {
    log("Install request failed: " + e.message);
  } finally {
    setBusy(false);
  }
}

async function doRevert() {
  setBusy(true);
  try {
    log("Reverting to stable...");
    const r = await api.fetchApi("/pr-installer/revert", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "stable" }),
    });
    const d = await r.json();
    if (d.status === "ok") log("REVERTED: " + d.message);
    else log("REVERT ERROR: " + (d.message || "unknown"));
    refreshStatus();
  } catch (e) {
    log("Revert failed: " + e.message);
  } finally {
    setBusy(false);
  }
}

function setPending(action, pr) {
  pendingAction = { action, pr };
  const banner = panelEl?.querySelector(".pri-confirm");
  if (!banner) return;
  banner.querySelector(".pri-confirm-text").textContent =
    action === "install"
      ? `Install PR #${pr}? This checks out untested code and runs pip install. A backup branch is created first.`
      : `Revert to stable? This overwrites the current checkout.`;
  banner.style.display = "block";
}
function clearPending() {
  pendingAction = null;
  const b = panelEl?.querySelector(".pri-confirm");
  if (b) b.style.display = "none";
}

function buildPanel(root) {
  panelEl = root;
  root.classList.add("pri-panel");
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.height = "100%";
  root.style.minHeight = "520px";
  root.style.gap = "8px";
  root.innerHTML = `
    <div class="pri-header">ComfyUI PR Installer</div>
    <div class="pri-status pri-box">Loading status...</div>

    <div class="pri-confirm" style="display:none">
      <div class="pri-confirm-text"></div>
      <div class="pri-confirm-actions">
        <button class="pri-btn pri-btn-small pri-btn-primary" data-action="confirm">Confirm</button>
        <button class="pri-btn pri-btn-small pri-btn-ghost" data-action="cancel">Cancel</button>
      </div>
    </div>

    <div class="pri-toolbar">
      <input class="pri-search" type="text" placeholder="Filter PRs (title / author / #)..." />
      <button class="pri-btn pri-btn-small" data-action="refresh">Refresh</button>
    </div>

    <div class="pri-list pri-box" style="flex:1; overflow-y:auto; max-height:420px; min-height:220px;">Loading PR list...</div>

    <div class="pri-manual">
      <input class="pri-num" type="number" min="1" placeholder="PR #" />
      <button class="pri-btn pri-btn-primary" data-action="install-manual">Install PR</button>
      <button class="pri-btn pri-btn-danger" data-action="revert">Revert to Stable</button>
    </div>

    <div class="pri-log pri-box"></div>`;

  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const action = t.dataset.action;
    if (action === "install") setPending("install", parseInt(t.dataset.pr, 10));
    else if (action === "install-manual") {
      const v = parseInt(root.querySelector(".pri-num").value, 10);
      if (v > 0) setPending("install", v);
      else log("Enter a valid PR number (> 0).");
    } else if (action === "revert") setPending("revert");
    else if (action === "confirm") {
      const p = pendingAction; clearPending();
      if (p) (p.action === "install" ? doInstall(p.pr) : doRevert());
    } else if (action === "cancel") clearPending();
    else if (action === "refresh") { refreshStatus(); loadList(); }
  });
  root.querySelector(".pri-search").addEventListener("input", (e) => renderList(e.target.value));

  refreshStatus();
  loadList();
}

function togglePanel() {
  app.extensionManager.toggleSidebarTab?.(SIDEBAR_ID);
}

app.registerExtension({
  name: EXT_ID,

  // No top-bar button (removed by request). The panel is opened from the left
  // sidebar tab (registered below) or via Alt+P.
  commands: [{
    id: `${EXT_ID}.open`, label: "Open PR Installer",
    icon: "icon-[lucide--git-pull-request]",
    function: () => togglePanel(),
  }],
  keybindings: [{ combo: { key: "p", alt: true }, commandId: `${EXT_ID}.open` }],

  async setup() {
    ensureStylesheet();
    // Sidebar tabs are imperative: register inside setup(), not at module top level.
    app.extensionManager.registerSidebarTab({
      id: SIDEBAR_ID,
      icon: "pi pi-github",
      title: "PR Installer",
      tooltip: "Install official ComfyUI PRs",
      type: "custom",
      render: (el) => buildPanel(el),
    });
  },
});
