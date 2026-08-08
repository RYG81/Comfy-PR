"""Backend nodes and server endpoints for ComfyUI-PR-Installer.
Follows best practices: unique names, defensive imports, proper pip via sys.executable,
clear error messages, no internal monkey-patching.
"""
import os
import json
import sys
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
    """Visible node that reports current PR-installer / git state.
    Category uses slash for sub-menu: ComfyUI Management/PR Tools
    """
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
# Server endpoint wiring (defensive)
# ------------------------------------------------------------------

def _make_handler():
    """Factory so we can import without immediate execution."""
    pass


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


def _handle_install(request):
    try:
        # aiohttp request parsing
        body = {}
        try:
            import asyncio
            # Try to read JSON body if available
            # In some ComfyUI versions request is aiohttp web.Request
            # We handle both sync/async patterns defensively
            if hasattr(request, "json"):
                if asyncio.iscoroutinefunction(request.json):
                    # Can't await here easily in sync handler; assume parsed by middleware or read manually
                    pass
                else:
                    body = request.json() or {}
            elif hasattr(request, "_body"):
                body = json.loads(request._body.decode("utf-8")) if isinstance(request._body, bytes) else {}
            elif hasattr(request, "post"):
                body = request.post() or {}
        except Exception:
            body = {}

        # Fallback: try to read payload from text if JSON failed
        if not body and hasattr(request, "text"):
            try:
                text = request.text() if callable(request.text) else request.text
                if isinstance(text, str) and text:
                    body = json.loads(text)
            except Exception:
                pass

        pr_number = int(body.get("pr", body.get("pr_number", 0)))
        if pr_number <= 0:
            return _json_resp(400, {"status": "error", "message": "Valid PR number required (pr > 0)"})

        # Run install in thread so UI doesn't freeze on long git operations
        # For simplicity in this endpoint we run synchronously but with timeout awareness
        branch, msg = checkout_pr(pr_number)
        # After checkout, try to install dependencies if requirements exist
        try:
            pip_msg = run_pip_deps()
        except Exception as e:
            pip_msg = f"Dependency install failed (non-critical): {e}"
        return _json_resp(200, {
            "status": "ok",
            "message": msg,
            "branch": branch,
            "pr": pr_number,
            "dependencies": pip_msg,
        })
    except Exception as e:
        return _json_resp(500, {"status": "error", "message": str(e)})


def _handle_revert(request):
    try:
        body = {}
        try:
            if hasattr(request, "json"):
                if callable(request.json) and not hasattr(request.json, "__call__"):
                    pass
                else:
                    # For aiohttp, if already parsed by middleware, try attribute
                    if hasattr(request, "_json"):
                        body = request._json or {}
            elif hasattr(request, "text"):
                text = request.text() if callable(request.text) else request.text
                if isinstance(text, str) and text:
                    body = json.loads(text)
        except Exception:
            pass

        mode = body.get("mode", "stable")
        tag, msg = revert_stable()
        return _json_resp(200, {
            "status": "ok",
            "message": msg,
            "mode": mode,
            "tag": tag,
        })
    except Exception as e:
        return _json_resp(500, {"status": "error", "message": str(e)})


def _json_resp(status_code: int, data: dict):
    # Return a simple dict that aiohttp can serialize if needed;
    # In ComfyUI custom nodes, endpoints usually return web.Response.
    # We provide both: this dict is used by our wrapper, and we also try to return web.Response.
    return {"_status": status_code, "_data": data}


# ------------------------------------------------------------------
# Route registration (called from __init__.py)
# ------------------------------------------------------------------

def _handle_list(request):
    try:
        import requests
        url = "https://api.github.com/repos/comfyanonymous/ComfyUI/pulls?state=open&per_page=30"
        headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "ComfyUI-PR-Installer"}
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            items = []
            for pr in data:
                items.append({
                    "pr_number": pr.get("number"),
                    "title": pr.get("title", "").strip(),
                    "author": pr.get("user", {}).get("login", "unknown") if isinstance(pr.get("user"), dict) else "unknown",
                    "state": pr.get("state", "unknown"),
                    "url": pr.get("html_url", ""),
                    "body": (pr.get("body") or "").strip(),
                })
            return {"_status": 200, "_data": {"status": "ok", "pr_list": items, "count": len(items)}}
        else:
            return {"_status": 502, "_data": {"status": "error", "message": f"GitHub API returned {resp.status_code}"}}
    except Exception as e:
        return {"_status": 500, "_data": {"status": "error", "message": str(e)}}


def add_routes():
    """Defensively register server routes using de-facto PromptServer API."""
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

    # Better: define proper handlers using a small wrapper class

    class HandlerWrapper:
        @staticmethod
        async def status(request):
            res = _handle_status(request)
            try:
                from aiohttp import web
                return web.json_response(res["_data"], status=res["_status"])
            except Exception:
                # If aiohttp not available (shouldn't happen in ComfyUI), return dict
                return res["_data"]

        @staticmethod
        async def install(request):
            res = _handle_install(request)
            try:
                from aiohttp import web
                return web.json_response(res["_data"], status=res["_status"])
            except Exception:
                return res["_data"]

        @staticmethod
        async def revert(request):
            res = _handle_revert(request)
            try:
                from aiohttp import web
                return web.json_response(res["_data"], status=res["_status"])
            except Exception:
                return res["_data"]


        @staticmethod
        async def list(request):
            res = _handle_list(request)
            try:
                from aiohttp import web
                return web.json_response(res["_data"], status=res["_status"])
            except Exception:
                return res["_data"]

    try:
        app.router.add_get("/pr-installer/status", HandlerWrapper.status)
        app.router.add_get("/pr-installer/list", HandlerWrapper.list)
        app.router.add_post("/pr-installer/install", HandlerWrapper.install)
        app.router.add_post("/pr-installer/revert", HandlerWrapper.revert)
        print("[ComfyUI-PR-Installer] Routes registered: /pr-installer/status, /list, /install, /revert")
    except Exception as e:
        print(f"[ComfyUI-PR-Installer] Route registration warning (non-critical): {e}")
