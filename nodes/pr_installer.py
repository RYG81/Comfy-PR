"""Backend nodes and server endpoints for ComfyUI-PR-Installer.

Fixes vs. the original:
- `_handle_install` / `_handle_revert` no longer try to read the aiohttp request
  body synchronously. aiohttp's `request.json()` is a *coroutine*, so the old
  synchronous read silently returned {} and every install/revert answered 400
  "Valid PR number required". The async handlers now `await request.json()` and
  pass the parsed dict in.
- `_handle_list` adds an optional `GITHUB_TOKEN` (avoids the 60 req/hr
  unauthenticated limit) and a short in-memory TTL cache so the toolbar button
  and "Refresh List" don't burn the rate limit.
"""
import os
import sys
import time
import threading
from typing import Optional

from .git_utils import (
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
# Node definition
# ------------------------------------------------------------------
class ComfyUI_PRInstaller_Status:
    """Visible node that reports current PR-installer / git state."""
    CATEGORY = "ComfyUI Management/PR Tools"
    FUNCTION = "execute"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("status_text",)

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {},
            "optional": {
                "pr_number": ("INT", {"default": 0, "min": 0, "max": 99999}),
            },
        }

    def execute(self, pr_number=0):
        root = get_comfyui_root()
        branch = get_current_branch(root)
        sha = get_current_sha(root)
        git_ok = is_git_repo(root)
        comfy_ok = is_origin_comfyui(root) if git_ok else False
        lines = [
            f"Root: {root}",
            f"Git repo: {git_ok}",
            f"Origin is ComfyUI: {comfy_ok}",
            f"Branch: {branch}",
            f"SHA: {sha}",
        ]
        if pr_number > 0:
            lines.append(f"Requested PR: #{pr_number}")
        return ("\n".join(lines),)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def _json_resp(status_code: int, data: dict):
    return {"_status": status_code, "_data": data}


async def _read_json(request):
    """aiohttp request.json() is a coroutine — await it. Returns {} on failure."""
    try:
        return await request.json()
    except Exception:
        return {}


def _handle_status(request):
    try:
        root = get_comfyui_root()
        data = {
            "root": root,
            "git_repo": is_git_repo(root),
            "comfy_origin": is_origin_comfyui(root) if is_git_repo(root) else False,
            "branch": get_current_branch(root),
            "sha": get_current_sha(root),
        }
        return _json_resp(200, data)
    except Exception as e:
        return _json_resp(500, {"status": "error", "message": str(e)})


def _handle_install(body: dict):
    try:
        body = body or {}
        pr_number = int(body.get("pr", body.get("pr_number", 0)))
        if pr_number <= 0:
            return _json_resp(400, {"status": "error", "message": "Valid PR number required (pr > 0)"})

        branch, msg = checkout_pr(pr_number)
        try:
            pip_msg = run_pip_deps()
        except Exception as e:
            pip_msg = f"Dependency install failed (non-critical): {e}"
        return _json_resp(
            200,
            {
                "status": "ok",
                "message": msg,
                "branch": branch,
                "pr": pr_number,
                "dependencies": pip_msg,
            },
        )
    except Exception as e:
        return _json_resp(500, {"status": "error", "message": str(e)})


def _handle_revert(body: dict):
    try:
        body = body or {}
        mode = body.get("mode", "stable")
        tag, msg = revert_stable()
        return _json_resp(200, {"status": "ok", "message": msg, "mode": mode, "tag": tag})
    except Exception as e:
        return _json_resp(500, {"status": "error", "message": str(e)})


# ---- PR list: token + short TTL cache --------------------------------------
_LIST_CACHE = {"ts": 0.0, "data": None}
_LIST_TTL = 60.0  # seconds


def _handle_list():
    now = time.time()
    if _LIST_CACHE["data"] is not None and (now - _LIST_CACHE["ts"]) < _LIST_TTL:
        return _json_resp(200, _LIST_CACHE["data"])

    try:
        import requests

        url = (
            "https://api.github.com/repos/comfyanonymous/ComfyUI/pulls"
            "?state=open&per_page=30&sort=created&direction=desc"
        )
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "ComfyUI-PR-Installer"}
        token = os.environ.get("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"

        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            items = []
            for pr in data:
                user = pr.get("user")
                author = user.get("login", "unknown") if isinstance(user, dict) else "unknown"
                items.append(
                    {
                        "pr_number": pr.get("number"),
                        "title": (pr.get("title") or "").strip(),
                        "author": author,
                        "state": pr.get("state", "unknown"),
                        "url": pr.get("html_url", ""),
                        "body": (pr.get("body") or "").strip(),
                    }
                )
            payload = {"status": "ok", "pr_list": items, "count": len(items)}
            _LIST_CACHE["data"] = payload
            _LIST_CACHE["ts"] = now
            return _json_resp(200, payload)
        return _json_resp(502, {"status": "error", "message": f"GitHub API returned {resp.status_code}"})
    except Exception as e:
        return _json_resp(500, {"status": "error", "message": str(e)})


# ------------------------------------------------------------------
# Route registration (called from __init__.py)
# ------------------------------------------------------------------
def add_routes():
    """Defensively register server routes using the PromptServer / aiohttp API."""
    try:
        from server import PromptServer
    except Exception:
        PromptServer = None
    if PromptServer is None:
        return
    try:
        app = PromptServer.instance.app
    except Exception:
        return
    try:
        from aiohttp import web
    except Exception:
        web = None
    if web is None:
        return

    class HandlerWrapper:
        @staticmethod
        async def status(request):
            res = _handle_status(request)
            return web.json_response(res["_data"], status=res["_status"])

        @staticmethod
        async def list(request):
            res = _handle_list()
            return web.json_response(res["_data"], status=res["_status"])

        @staticmethod
        async def install(request):
            body = await _read_json(request)
            res = _handle_install(body)
            return web.json_response(res["_data"], status=res["_status"])

        @staticmethod
        async def revert(request):
            body = await _read_json(request)
            res = _handle_revert(body)
            return web.json_response(res["_data"], status=res["_status"])

    try:
        app.router.add_get("/pr-installer/status", HandlerWrapper.status)
        app.router.add_get("/pr-installer/list", HandlerWrapper.list)
        app.router.add_post("/pr-installer/install", HandlerWrapper.install)
        app.router.add_post("/pr-installer/revert", HandlerWrapper.revert)
        print("[ComfyUI-PR-Installer] Routes registered: /pr-installer/status, /list, /install, /revert")
    except Exception as e:
        print(f"[ComfyUI-PR-Installer] Route registration warning (non-critical): {e}")
