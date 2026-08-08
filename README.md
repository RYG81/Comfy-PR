# ComfyUI-PR-Installer

A ComfyUI addon that lets non-technical users install Pull Requests from the official `comfyanonymous/ComfyUI` repository without using command-line git.

## What it does

- Shows current git state (branch / SHA) of your ComfyUI installation.
- Allows installing any PR by number (e.g., PR #1234) into your ComfyUI folder.
- Creates automatic backup branches before any checkout (reverting is safe).
- Reverts to the latest stable release tag with one click.
- Auto-detects `requirements.txt` and installs via `python -m pip`.

## Installation

1. Ensure your ComfyUI is installed from a **git repo** (or the folder is a git clone) so PR checkout works.
2. Copy or clone this folder into `ComfyUI/custom_nodes/ComfyUI-PR-Installer/`.
3. Restart ComfyUI.
4. A "PR Installer" button should appear in the top toolbar.

## How to use

Open the panel, enter a PR number, click **Install PR**. To go back, click **Revert to Stable**.

## Safety

- Before any install, a `pr-installer-backup-pr-<N>-<time>` branch is created.
- Only `pull/<N>/head` refs from `origin` are fetched.
- The addon does not modify ComfyUI internals directly; it uses standard git commands.

## Design notes

This addon follows official ComfyUI design guidelines (Mintlify best practices, Discussion #2635): unique naming (`ComfyUI_PRInstaller_*`), folder-compliant installation, `WEB_DIRECTORY`, defensive endpoint registration, `sys.executable -m pip`, no `torch` in requirements, and documentation.
