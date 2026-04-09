# Dockium Feature Reference

This document is derived from the codebase, not from product guesswork. Each section lists the implementation files first, then explains how the feature works and why the project uses the current framework or runtime.

## 1. Electron Desktop Shell

Implementation:

- [electron/main.cjs](../electron/main.cjs)
- [electron/preload.cjs](../electron/preload.cjs)
- [electron/ipc/\*.cjs](../electron/ipc/)
- [src/App.jsx](../src/App.jsx)
- [src/components/Layout.jsx](../src/components/Layout.jsx)
- [src/app.css](../src/app.css)

How it works:

- Electron owns the application shell, window lifecycle, IPC bridge, and access to native capabilities.
- The React renderer handles the UI while the preload script exposes a controlled `window.dockium` API.
- The main process initializes Docker, git, proxy, scanning, and reporting services.

Why Electron is required:

- Dockium needs filesystem access, git integration, Docker control, and browser/webview orchestration that a pure browser app cannot provide.
- A desktop shell keeps the UI close to the local runtime and lets the app manage processes and windows directly.

## 2. Onboarding and New Project Setup

Implementation:

- [src/pages/Onboarding.jsx](../src/pages/Onboarding.jsx)
- [src/store/uiStore.js](../src/store/uiStore.js)
- [src/App.jsx](../src/App.jsx)
- [src/components/Layout.jsx](../src/components/Layout.jsx)
- [src/pages/Dashboard.jsx](../src/pages/Dashboard.jsx)
- [electron/main.cjs](../electron/main.cjs)

How it works:

- The onboarding flow detects project metadata, accepts Docker image imports, and persists onboarding state.
- The UI can render the setup flow as an embedded overlay instead of a standalone page.
- The dashboard and menu actions open the onboarding overlay when the user asks for New Project.

Why React state management is required:

- Onboarding spans multiple steps, background initialization, modal visibility, and cross-page state.
- Zustand keeps the modal state and initialization state simple without pushing everything through routing.

## 3. Dashboard and Project Summary

Implementation:

- [src/pages/Dashboard.jsx](../src/pages/Dashboard.jsx)
- [src/store/containerStore.js](../src/store/containerStore.js)
- [electron/core/orchestrator/ContainerManager.js](../electron/core/orchestrator/ContainerManager.js)

How it works:

- The dashboard shows the current project, runtime status, container list, and recent scan summary.
- Container rows come from the Electron main process via IPC.
- The created timestamp is formatted into Today / Yesterday / relative time in the renderer.

Why this structure is required:

- The dashboard is a live view of runtime state, so it needs both Electron data access and React rendering.
- Formatting in the renderer keeps the Docker data source simple while still giving users readable time labels.

## 4. Container Orchestration

Implementation:

- [electron/core/orchestrator/ContainerManager.js](../electron/core/orchestrator/ContainerManager.js)
- [electron/core/orchestrator/NetworkManager.js](../electron/core/orchestrator/NetworkManager.js)
- [electron/core/orchestrator/HealthMonitor.js](../electron/core/orchestrator/HealthMonitor.js)
- [electron/ipc/docker.ipc.cjs](../electron/ipc/docker.ipc.cjs)

How it works:

- Dockium creates and manages Docker containers for the app, proxy, optional database, and scanner flows.
- It builds a dedicated Docker network and starts containers in the correct order.
- It inspects container state and health to drive the UI and status views.

Why Docker is required:

- Dockium’s workflow depends on containerized app/proxy/scanner components and isolated runtime networks.
- Docker Desktop provides the local runtime environment that the main process orchestrates.

## 5. App Map and Route Intelligence

Implementation:

- [src/pages/AppMap.jsx](../src/pages/AppMap.jsx)
- [src/store/mapStore.js](../src/store/mapStore.js)
- [electron/core/mapper/\*](../electron/core/mapper/)
- [electron/core/detector/\*](../electron/core/detector/)

How it works:

- App Map builds folder, route, and API graphs from the loaded project.
- It tracks auth flows, route testing, OpenAPI clues, and post-login scanning.
- After auth succeeds, it can automatically refresh the route view and switch to the route tab.

Why the current framework is required:

- React is a good fit for a dense, data-driven analysis workspace with tabs, graphs, and fast rerenders.
- The Electron-backed runtime can combine static source analysis with live runtime data.

## 6. Scanner and Fleet

Implementation:

- [src/pages/Scanner.jsx](../src/pages/Scanner.jsx)
- [src/store/fleetStore.js](../src/store/fleetStore.js)
- [electron/core/browser/BrowserFleet.js](../electron/core/browser/BrowserFleet.js)
- [electron/core/browser/roles/LegitUser.js](../electron/core/browser/roles/LegitUser.js)
- [electron/core/browser/roles/AttackerUser.js](../electron/core/browser/roles/AttackerUser.js)
- [electron/core/browser/roles/AdminMapper.js](../electron/core/browser/roles/AdminMapper.js)

How it works:

- The scanner coordinates browser roles to explore the application.
- The fleet performs auth prechecks before launch and surfaces auth state to the UI.
- The role logic filters out API-like routes so browsers focus on real UI navigation instead of stalling on raw endpoints.

Why browser automation is required:

- Dockium needs real browser behavior to verify pages, auth flows, links, and interactive surfaces.
- Headless or embedded browsers allow repeatable UI scanning without requiring the user to manually click through the app.

## 7. Proxy and Request Capture

Implementation:

- [src/pages/ProxyView.jsx](../src/pages/ProxyView.jsx)
- [src/store/proxyStore.js](../src/store/proxyStore.js)
- [electron/core/proxy/\*](../electron/core/proxy/)
- [electron/ipc/proxy.ipc.cjs](../electron/ipc/proxy.ipc.cjs)

How it works:

- The proxy captures requests and responses from the application traffic.
- The UI can view, filter, and inspect live request data.
- The proxy feeds suspicious traffic into other scan workflows.

Why it needs Electron and Node:

- Intercepting and replaying local traffic requires Node networking and process control.
- A desktop runtime can coordinate browser traffic, proxying, and live request inspection together.

## 8. Git Gate and Security Checks

Implementation:

- [src/pages/GitGate.jsx](../src/pages/GitGate.jsx)
- [src/store/gitStore.js](../src/store/gitStore.js)
- [electron/core/git/GitGate.js](../electron/core/git/GitGate.js)
- [electron/core/git/GitHookInstaller.js](../electron/core/git/GitHookInstaller.js)
- [cli/commands/gateCheck.js](../cli/commands/gateCheck.js)
- [cli/commands/push.js](../cli/commands/push.js)

How it works:

- Dockium runs a gate check before push and records findings, logs, and report metadata.
- The CLI can block or warn depending on mode.
- The hook installer writes pre-push and post-commit hooks so git operations stay tied to the gate workflow.

Why this feature exists:

- The project is security-oriented, so push behavior needs policy checks and audit evidence.
- Git integration lets Dockium protect the commit pipeline rather than only showing results in the UI.

## 9. Reports and Evidence

Implementation:

- [src/pages/Report.jsx](../src/pages/Report.jsx)
- [src/store/scanStore.js](../src/store/scanStore.js)
- [electron/core/report/ReportBuilder.js](../electron/core/report/ReportBuilder.js)
- [electron/core/report/exporters/](../electron/core/report/exporters/)

How it works:

- Scan results are collected into a report model and exported into different formats.
- The report view lets the user inspect findings, evidence, and remediation information.
- Post-commit hooks can attach the latest report snapshot to commit logs.

Why this is needed:

- Security work is evidence-driven, so findings need exportable and reviewable artifacts.
- The report layer makes the scan output useful outside the live UI.

## 10. Snapshots, Secrets, CVE, and Settings

Implementation:

- [src/pages/SnapshotsPage.jsx](../src/pages/SnapshotsPage.jsx)
- [src/pages/SecretsPage.jsx](../src/pages/SecretsPage.jsx)
- [src/pages/CvePage.jsx](../src/pages/CvePage.jsx)
- [src/pages/Settings.jsx](../src/pages/Settings.jsx)
- [electron/core/scanner/\*](../electron/core/scanner/)
- [electron/core/db/\*](../electron/core/db/)

How it works:

- Snapshots keep reproducible states for debugging and handoff.
- Secrets and CVE views expose security-specific findings.
- Settings control runtime behavior such as scanning, proxying, telemetry, and UI preferences.

Why these screens are separate:

- They represent different security and operational concerns, so isolating them keeps the UI clearer and the logic easier to maintain.

## 11. CLI and Desktop Build

Implementation:

- [package.json](../package.json)
- [electron-builder.yml](../electron-builder.yml)
- [electron/assets/dockium.ico](../electron/assets/dockium.ico)

How it works:

- The CLI runs independently from the renderer.
- Electron Builder packages the desktop app into a Windows installer.
- The custom icon is wired into the BrowserWindow configuration and the Windows build configuration.

Why packaging matters:

- Dockium is meant to be a local desktop tool, so installer packaging is part of the product.
- A branded icon and installer make the app look like a real desktop product instead of an Electron prototype.

## Feature Map Summary

If you want to trace a feature from the UI to its implementation, start with the page file in `src/pages/`, then follow the matching store in `src/store/`, and finally check the Electron module in `electron/core/` or the CLI module in `cli/`.
