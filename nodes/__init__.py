# Nodes package for ComfyUI-PR-Installer
from .pr_installer import ComfyUI_PRInstaller_Status
from .git_utils import (
    is_git_repo,
    get_comfyui_root,
    create_backup_branch,
    checkout_pr,
    revert_stable,
    run_pip_deps,
)

NODE_CLASS_MAPPINGS = {
    "ComfyUI_PRInstaller_Status": ComfyUI_PRInstaller_Status,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ComfyUI_PRInstaller_Status": "PR Installer Status (Official Repo)",
}

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "ComfyUI_PRInstaller_Status",
]
