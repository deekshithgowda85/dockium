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
- Runtime boot now includes app, proxy, scanner, and ZAP containers (plus optional DB).
- ZAP image pull uses stable fallback candidates to improve first-run download reliability.
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
