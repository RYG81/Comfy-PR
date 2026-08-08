# ComfyUI PR Installer — Design & Research Document

## Clarified Scope (from ask_user)
- Source: Only official comfyanonymous/ComfyUI PRs
- UI: Manager-style panel
- Deps: Auto-install via python -m pip
- Safety: Backup branches + revert to stable

## Guidelines Followed (Mintlify Best Practices + Discussion #2635)
- Unique names (ComfyUI_PRInstaller_*)
- Git/Folder compliant (single folder, WEB_DIRECTORY, no file copying)
- Requirements listed (requests only, no torch, no pip)
- Defensive endpoint wiring (PromptServer try/except, aiohttp wrapper)
- python -m pip for dependencies
- Documentation (README, docs/usage.md, example_workflows)
- No monkey-patching, no global module pollution

## Architecture
- Backend: nodes/git_utils.py (subprocess git), nodes/pr_installer.py (node + endpoints)
- Frontend: web/pr_installer.js (toolbar button + modal, fetch /pr-installer/*)
- Endpoints: GET /status, POST /install, POST /revert
- Safety: backup branch created before checkout; revert checks out latest tag

## References
[^1] https://mintlify.wiki/Comfy-Org/ComfyUI/extensions/best-practices
[^2] https://github.com/Comfy-Org/ComfyUI/discussions/2635
[^3] https://github.com/Comfy-Org/ComfyUI-Manager
[^4] https://blog.comfy.org/p/dependency-resolution-and-custom
