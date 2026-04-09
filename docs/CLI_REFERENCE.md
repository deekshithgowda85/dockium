# Dockium CLI Reference

This document is derived from the CLI source files:

- [cli/index.js](../cli/index.js)
- [cli/commands/init.js](../cli/commands/init.js)
- [cli/commands/push.js](../cli/commands/push.js)
- [cli/commands/gateCheck.js](../cli/commands/gateCheck.js)
- [electron/core/git/GitHookInstaller.js](../electron/core/git/GitHookInstaller.js)

## Overview

Dockium exposes a small CLI that initializes a repository, runs the push workflow, and executes the gate check used by git hooks.

The CLI is implemented with `commander` and is the same command surface used by the packaged app and the generated git hooks.

## Commands

### `dockium init`

Implementation: [cli/commands/init.js](../cli/commands/init.js)

What it does:

- Prompts for project name, target URL, app port, and test command.
- Writes `.dockium/config.json`.
- Installs git hooks through [GitHookInstaller.js](../electron/core/git/GitHookInstaller.js).
- Adds local ignore rules for Dockium report and log artifacts.

How it works:

- Reads the current working directory as the project root.
- Creates `.dockium/` if needed.
- Persists a project config object that the Electron app and CLI can reuse.
- Installs a pre-push hook that runs `dockium gate-check --warn-only`.
- Installs a post-commit hook that writes a Markdown audit log with diff and report snapshot.

Why it uses this workflow:

- The CLI needs a project-scoped config so the Electron runtime and git hooks can share the same project context.
- Git hooks keep guardrails close to the repository, so pushes and commits stay consistent even outside the app.

### `dockium push`

Implementation: [cli/commands/push.js](../cli/commands/push.js)

Flags:

- `--remote <r>`: remote name, default `origin`
- `--branch <b>`: branch to push
- `--skip-gate`: skip the gate check entirely
- `--enforce-gate`: block push when the gate reports blockers
- `--allow-report-artifacts`: allow Dockium report artifacts in pushed history
- `--auto-commit`: commit local changes before gate and push
- `--commit-message <msg>`: commit message used with `--auto-commit`

What it does:

- Detects dirty working trees.
- Optionally auto-commits changes.
- Checks whether the local branch is ahead of the remote.
- Runs `GitGate` unless `--skip-gate` is set.
- Pushes with `--no-verify` after Dockium has performed its own checks.

How it works:

- Resolves the branch from the git status when not passed explicitly.
- Wraps preconditions in fail-safe error handling so the CLI fails with a clear reason.
- Emits progress and result events over the live bridge.
- Blocks report artifact files unless `--allow-report-artifacts` is set.
- Treats gate blockers as warn-only unless `--enforce-gate` is passed.

Why it uses this workflow:

- Push needs to be safe by default because the repository may contain generated security artifacts and partially scanned states.
- The explicit flags let teams choose between strict enforcement and a softer warning mode.

### `dockium gate-check`

Implementation: [cli/commands/gateCheck.js](../cli/commands/gateCheck.js)

Flags:

- `--warn-only`: do not block on policy findings
- `--enforce-gate`: strict mode; block when policy fails

What it does:

- Runs a gate check against the current repository state.
- Emits structured result data for the app and hooks.
- Persists reports when the gate engine asks for it.

How it works:

- Uses `GitGate` to evaluate the current commit range.
- Default mode is warn-only unless strict enforcement is requested.
- Converts gate output into a normalized result that the UI and hooks can consume.
- Returns non-zero only for execution/runtime failure or strict blocking.

Why it uses this workflow:

- Hooks need a fast command path with predictable exit behavior.
- Warn-only mode keeps `git push` usable while still surfacing security issues.

## Generated Git Hooks

Implementation: [electron/core/git/GitHookInstaller.js](../electron/core/git/GitHookInstaller.js)

Installed hooks:

- `pre-push`: runs `dockium gate-check --warn-only`
- `post-commit`: writes a Markdown audit log into `.dockium/logs/`

How the post-commit log works:

- Captures commit metadata.
- Includes the full `git show --pretty=format: --no-color HEAD` diff.
- Appends the latest report snapshot from `.dockium/reports/push-*.json` if present.

Why it exists:

- The hooks preserve an audit trail without requiring the user to manually capture commit context.
- The logs make it easier to review what changed and which report snapshot matched the commit.

## Typical Flows

### Fresh project

1. Run `dockium init`.
2. Review `.dockium/config.json`.
3. Commit the generated hook and config changes if needed.

### Safe push

1. Run `dockium push`.
2. Dockium checks for dirty files and branch state.
3. Dockium runs the gate check.
4. Dockium pushes only when the workflow allows it.

### Strict push

1. Run `dockium push --enforce-gate`.
2. Dockium blocks on policy failures instead of warning.

## Notes

- The CLI is intentionally separate from the Electron renderer so it can run in terminals, hooks, and CI-like contexts.
- The same project config and gate rules are shared between the CLI, hooks, and UI through `.dockium/` state.
