"""Safe git wrappers for ComfyUI-PR-Installer.
Follows ComfyUI best practices:
- Defensive checks (git exists, repo exists, return codes checked)
- Use sys.executable for pip
- No assumption of python_embeded
- No monkey-patching of ComfyUI internals
"""
import os
import shutil
import subprocess
import sys
import time
from typing import List, Optional, Tuple


def get_comfyui_root() -> str:
    """Resolve ComfyUI installation root relative to this extension."""
    # This file is at: .../custom_nodes/ComfyUI-PR-Installer/nodes/git_utils.py
    # ComfyUI root is two levels up from extension folder.
    ext_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    root = os.path.abspath(os.path.join(ext_dir, "..", ".."))
    # Fallback to COMFYUI_PATH env or cwd if structure is different
    if not os.path.isdir(os.path.join(root, ".git")) and os.path.isdir(os.path.join(root, "comfy")):
        return root
    env_path = os.environ.get("COMFYUI_PATH")
    if env_path and os.path.isdir(os.path.join(env_path, ".git")):
        return env_path
    cwd = os.getcwd()
    if os.path.isdir(os.path.join(cwd, ".git")):
        return cwd
    # Last resort: assume root is parent of extension folder even if no .git
    return root


def is_git_repo(path: Optional[str] = None) -> bool:
    if path is None:
        path = get_comfyui_root()
    git_dir = os.path.join(path, ".git")
    return os.path.isdir(git_dir)


def git_binary() -> Optional[str]:
    return shutil.which("git")


def run_git(cmd: List[str], cwd: Optional[str] = None, check: bool = True) -> subprocess.CompletedProcess:
    """Run a git command defensively."""
    git_bin = git_binary()
    if git_bin is None:
        raise RuntimeError("Git binary not found. Please install Git.")
    if cwd is None:
        cwd = get_comfyui_root()
    full = [git_bin] + cmd
    result = subprocess.run(
        full,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"Git command failed (exit {result.returncode}): {' '.join(cmd)}\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
    return result


def create_backup_branch(pr_number: int, cwd: Optional[str] = None) -> str:
    branch_name = f"pr-installer-backup-pr-{pr_number}-{int(time.time())}"
    run_git(["branch", branch_name], cwd=cwd, check=False)
    return branch_name


def fetch_pr(pr_number: int, cwd: Optional[str] = None) -> str:
    """Fetch PR into a local branch pr-<N>."""
    local_branch = f"pr-{pr_number}"
    # Fetch from GitHub pull refs
    run_git(
        ["fetch", "origin", f"pull/{pr_number}/head:{local_branch}"],
        cwd=cwd,
    )
    return local_branch


def checkout_pr(pr_number: int, cwd: Optional[str] = None) -> Tuple[str, str]:
    root = cwd or get_comfyui_root()
    if not is_git_repo(root):
        raise RuntimeError(f"Not a git repo at {root}. Cannot install PR.")
    # Backup current state
    backup = create_backup_branch(pr_number, cwd=root)
    # Fetch PR
    branch = fetch_pr(pr_number, cwd=root)
    # Checkout
    run_git(["checkout", branch], cwd=root)
    # Get new HEAD sha for logging
    result = run_git(["rev-parse", "HEAD"], cwd=root)
    sha = result.stdout.strip()
    return branch, f"Installed PR #{pr_number} -> {branch} (sha {sha}). Backup branch: {backup}"


def revert_stable(cwd: Optional[str] = None) -> Tuple[str, str]:
    root = cwd or get_comfyui_root()
    if not is_git_repo(root):
        raise RuntimeError(f"Not a git repo at {root}.")
    # Try to get latest tag (release) or fall back to main
    try:
        tag_res = run_git(["describe", "--tags", "--abbrev=0"], cwd=root, check=False)
        if tag_res.returncode == 0:
            tag = tag_res.stdout.strip()
        else:
            tag = "main"
    except Exception:
        tag = "main"
    # Checkout stable
    run_git(["checkout", tag], cwd=root, check=False)
    # Clean untracked only if user wants; we skip destructive clean by default
    result = run_git(["rev-parse", "HEAD"], cwd=root)
    sha = result.stdout.strip()
    return tag, f"Reverted to stable ({tag}) at sha {sha}."


def get_current_branch(cwd: Optional[str] = None) -> str:
    root = cwd or get_comfyui_root()
    res = run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=root, check=False)
    return res.stdout.strip() if res.returncode == 0 else "unknown"


def get_current_sha(cwd: Optional[str] = None) -> str:
    root = cwd or get_comfyui_root()
    res = run_git(["rev-parse", "HEAD"], cwd=root, check=False)
    return res.stdout.strip() if res.returncode == 0 else "unknown"


def run_pip_deps(cwd: Optional[str] = None) -> str:
    """Install requirements if they exist, using python -m pip."""
    root = cwd or get_comfyui_root()
    req_file = os.path.join(root, "requirements.txt")
    if not os.path.isfile(req_file):
        return "No requirements.txt found; nothing to install."
    # Defensive: only install if file exists and git is present (we already checked)
    cmd = [sys.executable, "-m", "pip", "install", "-r", req_file]
    result = subprocess.run(
        cmd,
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    msg = f"Pip install exit={result.returncode}\nstdout: {result.stdout}\nstderr: {result.stderr}"
    if result.returncode != 0:
        raise RuntimeError(f"Dependency installation failed. {msg}")
    return msg


def is_origin_comfyui(cwd: Optional[str] = None) -> bool:
    root = cwd or get_comfyui_root()
    res = run_git(["remote", "get-url", "origin"], cwd=root, check=False)
    url = res.stdout.strip() if res.returncode == 0 else ""
    return "comfyanonymous/ComfyUI" in url or "github.com/Comfy-Org/ComfyUI" in url
