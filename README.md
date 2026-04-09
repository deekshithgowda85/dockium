# Dockium

Dockium is a desktop security workbench built with Electron + React. It combines project ingestion, Docker-based runtime orchestration, scanning workflows, proxy traffic inspection, reporting, and App Map visualization in a single local application.

## Highlights

- Desktop-first security workflow with no external backend service required.
- Onboarding supports:
  - Local project folder ingestion.
  - Docker image import (including Docker Hub repository URLs).
- Multi-panel UI:
  - Dashboard.
  - App Map (Folder Tree, Route Tree, API Graph).
  - Proxy, Scanner, CVE, Git Gate, Reports, Settings.
- Runtime modules in Electron main process:
  - Container orchestration.
  - Scanning orchestrator.
  - Proxy + capture.
  - Report generation.
  - Browser fleet automation.

## Tech Stack

- Electron
- React + Vite
- React Router
- Zustand state stores
- Node-based core modules in Electron main process

## Repository Structure

- Main process bootstrap: [electron/main.cjs](electron/main.cjs)
- Renderer bridge: [electron/preload.cjs](electron/preload.cjs)
- IPC handlers: [electron/ipc](electron/ipc)
- Core runtime modules: [electron/core](electron/core)
- Renderer app: [src](src)

## Local Development

Prerequisites:

- Node.js 18+
- npm
- Docker Desktop (for container runtime features)

Install and run:

```bash
npm install
npm run dev
```

What `npm run dev` does:

- Starts Vite renderer dev server.
- Waits for renderer port.
- Starts Electron pointing to renderer URL.

## Dockium CLI (Git Gate)

Dockium now includes a standalone CLI for git gate workflows:

- `dockium init`
- `dockium push`
- `dockium gate-check`

### Make `dockium` Recognizable On Your Computer

From the repository root:

```bash
npm install
npm link
```

Then verify:

```bash
dockium --help
```

If your shell has not refreshed PATH yet, open a new terminal window.

Fallback options:

```bash
npm run dockium -- --help
node ./bin/dockium.js --help
```

### Command Usage

Initialize project config + pre-push hook:

```bash
dockium init
```

Run gate then push:

```bash
dockium push
```

`dockium push` only pushes existing local commits. If there are no commits ahead of the remote branch, it exits with a clear "Nothing to push" message.

By default, `dockium push` runs security checks and then continues push in warn-only mode even if findings are reported.
To enforce hard blocking behavior, use `--enforce-gate`.

```bash
dockium push --enforce-gate
```

By default, `dockium push` blocks when report artifacts are detected in unpushed commits (for example `dockium-report-*.docx` or `.dockium/reports/*`).
If this is intentional, override with:

```bash
dockium push --allow-report-artifacts
```

To auto-commit local changes before gate and push:

```bash
dockium push --auto-commit --commit-message "chore: update challenge skill"
```

Skip gate and push directly:

```bash
dockium push --skip-gate
```

Run gate check only (used by git hook):

```bash
dockium gate-check
```

## End-to-End Validation Path

Use this checklist to validate init, push, gate-check, hook behavior, and live UI updates.

### 1) Validate Init

```bash
dockium init
```

Confirm files:

```bash
cat .dockium/config.json
cat .git/hooks/pre-push
```

Expected hook behavior:

- runs `dockium gate-check` if available
- falls back to `node ./bin/dockium.js gate-check`

### 2) Validate gate-check command

```bash
dockium gate-check
```

Expected:

- prints `[Gate] Step 1/5 ... Step 5/5` style logs
- exits non-zero when policy is blocked or any gate error occurs

### 3) Validate push command

```bash
dockium push --skip-gate
dockium push
```

Expected:

- `--skip-gate` pushes directly
- normal push runs gate and blocks/forwards based on findings/tests/policy

### 4) Validate pre-push hook

```bash
git push origin <your-branch>
```

Expected:

- hook invokes `dockium gate-check`
- push is blocked when gate fails

### 5) Validate live Git Gate UI updates

1. Start Dockium app (`npm run dev`)
2. Open `Git Gate` page in the app
3. Run `dockium push` in a terminal
4. Confirm in UI:

- live step logs in `LIVE GATE LOG`
- new push row in history with result/severity summary

Notes:

- CLI publishes realtime events to the running app through local WebSocket (`ws://127.0.0.1:4242`).
- Push reports are persisted under `.dockium/reports/push-*.json` and loaded into history.

## Build and Packaging

Build renderer only:

```bash
npm run build
```

Package (directory output):

```bash
npm run pack
```

Windows installer:

```bash
npm run dist:win
```

All configured platforms:

```bash
npm run dist:all
```

Packaging configuration is in [electron-builder.yml](electron-builder.yml).

## Core Workflows

### 1) New Project / Onboarding

- Option A: select a local source folder.
- Option B: import a Docker image URL.
- On completion, project context is hydrated and persisted.

### 2) Dashboard

- Shows active project metadata:
  - name
  - path
  - framework/version
  - target URL
  - DB type
  - route count
- Shows runtime status + container summaries.

### 3) App Map

- Folder Tree: browsable structure + annotations.
- Route Tree: route listing with details and filtering.
- API Graph: endpoint flow, schema details, auth boundary context.

## Docker Runtime Notes

- Docker Runtime panel shows current running containers and a running count.
- Runtime boot now includes app, proxy, and scanner containers (plus optional DB).
- Active scanning runs through Dockerized Nuclei sessions when triggered from Active Scan.
- If Docker daemon is unavailable, import/start actions return explicit error messages.

## Troubleshooting

### ERR_CONNECTION_REFUSED for localhost URLs

Possible causes:

- Target app container is not running.
- Wrong target URL persisted in onboarding config.
- Dev renderer port mismatch.

Actions:

1. Restart Docker Desktop.
2. Re-open onboarding and confirm target/port.
3. Restart Electron fully after IPC/main-process changes.

### Dashboard shows No project

Actions:

1. Open New Project Setup.
2. Re-select local project or imported image.
3. Click Open App Now.

## Security and Privacy

- Runs locally by default.
- Secrets and vulnerability findings should be reviewed before sharing reports.
- Keep `.env` and local runtime artifacts out of version control.

## Contributing

1. Create a branch.
2. Make focused commits.
3. Validate affected flows manually.
4. Open pull request with screenshots/log snippets for UI/runtime changes.
