# Nodes package for ComfyUI-PR-Installer
#
# NOTE: NODE_CLASS_MAPPINGS / NODE_DISPLAY_NAME_MAPPINGS are NOT redefined
# here on purpose. The actual registration ComfyUI reads lives in the
# top-level __init__.py, which imports ComfyUI_PRInstaller_Status directly
# from .pr_installer. A second copy of the mappings here was dead code —
# it was never imported by anything — and risked silently drifting out of
# sync with the real mappings.
from .pr_installer import ComfyUI_PRInstaller_Status
from .git_utils import (
    is_git_repo,
    get_comfyui_root,
    create_backup_branch,
    checkout_pr,
    revert_stable,
    run_pip_deps,
)

__all__ = [
    "ComfyUI_PRInstaller_Status",
    "is_git_repo",
    "get_comfyui_root",
    "create_backup_branch",
    "checkout_pr",
    "revert_stable",
    "run_pip_deps",
]
