"""
ComfyUI-PR-Installer
An official-repo PR management addon for ComfyUI.
Follows ComfyUI design guidelines: unique naming, WEB_DIRECTORY, defensive
endpoint registration, proper pip via sys.executable, no core monkey-patching.
"""
import os
import sys

# ------------------------------------------------------------------
# Defensive dependency installation (only if missing)
# ------------------------------------------------------------------

def _install_deps():
    req_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements.txt")
    if not os.path.isfile(req_path):
        return
    # We only install if requests not importable (defensive)
    try:
        import requests  # noqa: F401
    except Exception:
        # Install using python -m pip (official supported way)
        import subprocess
        cmd = [sys.executable, "-m", "pip", "install", "-r", req_path]
        print(f"[ComfyUI-PR-Installer] Installing dependencies via: {' '.join(cmd)}")
        try:
            subprocess.run(cmd, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
        except Exception as e:
            print(f"[ComfyUI-PR-Installer] Dependency installation warning (non-critical): {e}")

_install_deps()

# ------------------------------------------------------------------
# Import nodes
# ------------------------------------------------------------------

from .nodes.pr_installer import ComfyUI_PRInstaller_Status
from .nodes.git_utils import (
    get_comfyui_root,
    is_git_repo,
    get_current_branch,
    get_current_sha,
    checkout_pr,
    revert_stable,
    run_pip_deps,
    is_origin_comfyui,
)

# ------------------------------------------------------------------
# ComfyUI registration
# ------------------------------------------------------------------

NODE_CLASS_MAPPINGS = {
    "ComfyUI_PRInstaller_Status": ComfyUI_PRInstaller_Status,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ComfyUI_PRInstaller_Status": "PR Installer Status (Official Repo)",
}

# WEB_DIRECTORY tells ComfyUI where to serve frontend files from
WEB_DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

# ------------------------------------------------------------------
# Server routes (defensive)
# ------------------------------------------------------------------

def _register_routes():
    try:
        from .nodes.pr_installer import add_routes
        add_routes()
    except Exception as e:
        print(f"[ComfyUI-PR-Installer] Route registration skipped (may require server restart): {e}")

_register_routes()

# ------------------------------------------------------------------
# Startup info
# ------------------------------------------------------------------

print("[ComfyUI-PR-Installer] Loaded. Category: ComfyUI Management/PR Tools")
print("[ComfyUI-PR-Installer] Endpoints: /pr-installer/status, /install, /revert")
print("[ComfyUI-PR-Installer] Web directory:", WEB_DIRECTORY)
