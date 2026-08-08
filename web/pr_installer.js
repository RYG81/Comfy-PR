/**
 * ComfyUI-PR-Installer Frontend Extension
 * Now includes PR listing from GitHub API for official repo.
 */
(function () {
  "use strict";

  const INIT_INTERVAL = setInterval(() => {
    if (typeof app === "undefined" || !app.registerExtension) return;
    clearInterval(INIT_INTERVAL);
    initExtension();
  }, 300);

  // Create button immediately so it works even if app registration fails
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => createToolbarButton());
    } else {
      createToolbarButton();
    }
  }

  function initExtension() {
    app.registerExtension({
      name: "ComfyUI.PRInstaller",
      async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.python_module === "custom_nodes.ComfyUI-PR-Installer.nodes.pr_installer") {
          // hook available if needed
        }
      },
    });
    createToolbarButton();
  }

  function createToolbarButton() {
    const menu = document.querySelector(".comfy-menu") || document.querySelector("#comfy-menu") || document.body;
    const btn = document.createElement("button");
    btn.innerText = "PR Installer";
    btn.title = "Install official ComfyUI PRs from list";
    btn.style.cssText = "margin-left:8px;padding:6px 12px;border-radius:4px;background:#2a2a2a;color:#eee;border:1px solid #555;cursor:pointer;font-size:12px;font-family:sans-serif;";
    btn.onclick = () => openModal();
    const ref = document.querySelector("button[title='Save']") || document.querySelector(".comfy-button") || menu;
    if (ref && ref.parentElement) ref.parentElement.appendChild(btn);
    else menu.appendChild(btn);
  }

  function openModal() {
    if (document.getElementById("pr-installer-modal")) {
      document.getElementById("pr-installer-modal").style.display = "flex";
      refreshStatus();
      loadList();
      return;
    }
    const overlay = document.createElement("div");
    overlay.id = "pr-installer-modal";
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;font-family:sans-serif;color:#eee;";
    overlay.innerHTML = `
      <div style="background:#181818;border:1px solid #444;border-radius:10px;padding:24px;min-width:460px;max-width:92vw;max-height:92vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,0.8);">
        <h2 style="margin-top:0;color:#e6e6e6;">ComfyUI Official PR Installer</h2>
        <p style="font-size:12px;color:#aaa;margin-top:-8px;">Browse open PRs from <code>comfyanonymous/ComfyUI</code>, install with one click, or revert to stable.</p>

        <div id="pr-status-box" style="background:#222;padding:10px;border-radius:6px;margin-bottom:14px;font-size:12px;line-height:1.4;color:#ccc;min-height:60px;">Loading status...</div>

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <strong style="font-size:13px;color:#ddd;">Open PRs</strong>
          <button onclick="loadList()" style="padding:4px 10px;background:#4a7bff;border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:12px;">Refresh List</button>
        </div>

        <div id="pr-list" style="max-height:260px;overflow-y:auto;background:#111;border:1px solid #333;border-radius:6px;padding:8px;margin-bottom:14px;min-height:60px;font-size:12px;color:#ccc;line-height:1.3;">
          Loading PR list...
        </div>

        <label style="font-weight:bold;font-size:13px;">Manual entry (if needed)</label>
        <div style="display:flex;gap:8px;margin:6px 0 14px;">
          <input id="pr-num" type="number" min="1" max="99999" value="" style="flex:1;padding:8px;border-radius:4px;border:1px solid #666;background:#111;color:#eee;font-size:13px;" placeholder="Enter PR # directly">
          <button onclick="prInstall()" style="padding:8px 14px;background:#4a7bff;border:none;border-radius:4px;color:#fff;cursor:pointer;font-weight:bold;font-size:13px;">Install PR</button>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:14px;">
          <button onclick="prRevert()" style="flex:1;padding:10px;border-radius:4px;border:1px solid #777;background:#333;color:#ddd;cursor:pointer;font-size:13px;">Revert to Stable</button>
          <button onclick="refreshStatus()" style="flex:1;padding:10px;border-radius:4px;border:1px solid #777;background:#333;color:#ddd;cursor:pointer;font-size:13px;">Refresh Status</button>
        </div>

        <div id="pr-log" style="background:#111;padding:10px;border-radius:6px;font-size:12px;color:#ccc;min-height:60px;max-height:120px;overflow-y:auto;border:1px solid #333;">Logs will appear here.</div>

        <div style="margin-top:14px;text-align:right;">
          <button onclick="closeModal()" style="padding:8px 16px;background:#555;border:none;border-radius:4px;color:#fff;cursor:pointer;">Close</button>
        </div>
      </div>
    `;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
    document.body.appendChild(overlay);
    refreshStatus();
    loadList();
  }

  window.closeModal = () => {
    const m = document.getElementById("pr-installer-modal");
    if (m) m.style.display = "none";
  };

  window.refreshStatus = async () => {
    const box = document.getElementById("pr-status-box");
    if (!box) return;
    box.innerText = "Fetching status...";
    try {
      const res = await fetch("/pr-installer/status");
      const data = await res.json();
      box.innerHTML = `
        <strong>Root:</strong> ${data.root || "?"}<br>
        <strong>Git repo:</strong> ${data.git_repo ? "Yes" : "No"}<br>
        <strong>Origin = ComfyUI:</strong> ${data.comfy_origin ? "Yes" : "No"}<br>
        <strong>Branch:</strong> ${data.branch || "?"}<br>
        <strong>SHA:</strong> <code>${data.sha || "?"}</code>
      `;
    } catch (e) {
      box.innerText = "Status unavailable. Ensure ComfyUI server is running.";
      appendLog("Status error: " + e.message);
    }
  };

  window.loadList = async () => {
    const listDiv = document.getElementById("pr-list");
    if (!listDiv) return;
    listDiv.innerHTML = "Fetching PR list from GitHub...";
    try {
      const res = await fetch("/pr-installer/list");
      const data = await res.json();
      if (data.status !== "ok" || !data.pr_list) {
        listDiv.innerHTML = `<div style="color:#ff8888;">Failed to load list: ${data.message || "Unknown"}</div>`;
        return;
      }
      if (data.pr_list.length === 0) {
        listDiv.innerHTML = '<div style="color:#aaa;">No open PRs found.</div>';
        return;
      }
      let html = "";
      data.pr_list.forEach(pr => {
        const title = (pr.title || "Untitled").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const bodyRaw = (pr.body || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const bodyText = bodyRaw ? bodyRaw.substring(0, 2000) + (bodyRaw.length > 2000 ? "\n... (truncated)" : "") : "<em style='color:#888;'>No description provided.</em>";
        html += `
          <div style="padding:10px;border-bottom:1px solid #333;background:#171717;border-radius:6px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
              <button onclick="prInstallFromList(${pr.pr_number})" style="padding:6px 12px;background:#2a7bff;border:none;border-radius:4px;color:#fff;cursor:pointer;font-weight:bold;font-size:12px;white-space:nowrap;">Install #${pr.pr_number}</button>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;color:#eee;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${title.replace(/"/g, "'")}">${title}</div>
                <div style="font-size:11px;color:#aaa;">by <strong>${pr.author || "?"}</strong> • ${pr.state || "?"} • <a href="${pr.url || "#"}" target="_blank" style="color:#4a7bff;text-decoration:none;">GitHub →</a></div>
              </div>
            </div>
            <div style="background:#0a0a0a;padding:10px;border-radius:5px;border:1px solid #333;max-height:160px;overflow-y:auto;font-size:11.5px;color:#ccc;white-space:pre-wrap;line-height:1.35;">${bodyText}</div>
          </div>`;
      });
      listDiv.innerHTML = html;
    } catch (e) {
      listDiv.innerHTML = `<div style="color:#ff8888;">Error loading list: ${e.message}</div>`;
    }
  };

  window.prInstallFromList = (num) => {
    document.getElementById("pr-num").value = num;
    prInstall();
  };

  window.prInstall = async () => {
    const input = document.getElementById("pr-num");
    const val = parseInt(input.value, 10);
    const log = document.getElementById("pr-log");
    if (!val || val < 1) {
      appendLog("Please enter a valid PR number (> 0).");
      return;
    }
    appendLog(`Starting install for PR #${val}...`);
    try {
      const res = await fetch("/pr-installer/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pr: val }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        appendLog("SUCCESS: " + data.message);
        appendLog("Dependencies: " + (data.dependencies || "N/A"));
        refreshStatus();
      } else {
        appendLog("ERROR: " + (data.message || "Unknown error"));
      }
    } catch (e) {
      appendLog("Install request failed: " + e.message);
    }
  };

  window.prRevert = async () => {
    const log = document.getElementById("pr-log");
    appendLog("Reverting to stable / latest release tag...");
    try {
      const res = await fetch("/pr-installer/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "stable" }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        appendLog("REVERTED: " + data.message);
        refreshStatus();
      } else {
        appendLog("REVERT ERROR: " + (data.message || "Unknown"));
      }
    } catch (e) {
      appendLog("Revert request failed: " + e.message);
    }
  };

  function appendLog(msg) {
    const log = document.getElementById("pr-log");
    if (!log) return;
    const line = document.createElement("div");
    line.textContent = "[" + new Date().toLocaleTimeString() + "] " + msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
})();
