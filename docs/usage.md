# Usage Guide — ComfyUI-PR-Installer

## Prerequisites

- ComfyUI must be installed from Git (`git clone ...`) or converted to a git repo, because PR installation uses `git fetch`.
- Git must be installed and available in system PATH.
- The `origin` remote should point to `comfyanonymous/ComfyUI` (or `Comfy-Org/ComfyUI`).

## Panel UI

A toolbar button labeled **"PR Installer"** opens a modal with:

- **Status Box**: Shows root path, git repo status, branch, SHA.
- **PR Number Input**: Type the PR number (e.g., `1234`) and click **Install PR**.
- **Revert to Stable**: Checks out the latest tag and removes PR branch.
- **Refresh Status**: Updates info from server.
- **Log Area**: Real-time output.

## Workflow Node (optional)

Add node `PR Installer Status (Official Repo)` from category `ComfyUI Management/PR Tools` if you want to display status inside your workflow (outputs a STRING).

## Reverting

If something breaks after installing a PR:
1. Open panel.
2. Click **Revert to Stable**.
3. Restart ComfyUI if needed.

The original state is preserved in an auto-created backup branch named `pr-installer-backup-pr-<N>-<timestamp>`.
