import fs from 'fs'
import path from 'path'

class GitHookInstaller {
  async install(repoPath) {
    console.log('[GitHookInstaller] Installing git pre-push hook')

    const hookPath = path.join(repoPath, '.git', 'hooks', 'pre-push')
    const hooksDir = path.dirname(hookPath)

    // Ensure hooks directory exists
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true })
    }

    // Create pre-push hook script
    const prePushHookScript = `#!/bin/sh
# DOCKIUM Pre-push Hook
# This hook intercepts git push and runs Dockium gate check

echo "[DOCKIUM] Running gate check before push..."

if command -v dockium >/dev/null 2>&1; then
  dockium gate-check --warn-only
elif [ -f "./bin/dockium.js" ]; then
  node ./bin/dockium.js gate-check --warn-only
else
  echo "[DOCKIUM] gate-check command not found (expected: dockium or ./bin/dockium.js)"
  exit 1
fi

RESULT=$?

if [ $RESULT -ne 0 ]; then
  echo "[DOCKIUM] Gate check failed - push blocked"
  exit 1
fi

echo "[DOCKIUM] Gate check passed - proceeding with push"
exit 0
`

    fs.writeFileSync(hookPath, prePushHookScript)
    fs.chmodSync(hookPath, 0o755)

    console.log(`[GitHookInstaller] Pre-push hook installed at ${hookPath}`)

    const postCommitHookPath = path.join(repoPath, '.git', 'hooks', 'post-commit')
    const postCommitHookScript = `#!/bin/sh
# DOCKIUM Post-commit Hook
# Writes a commit audit log with git diff and latest Dockium report snapshot.

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi

LOG_DIR="$REPO_ROOT/.dockium/logs"
REPORT_DIR="$REPO_ROOT/.dockium/reports"

mkdir -p "$LOG_DIR"

COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null)
COMMIT_FULL=$(git rev-parse HEAD 2>/dev/null)
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
AUTHOR_LINE=$(git log -1 --pretty=format:'%an <%ae>' 2>/dev/null)
SUBJECT_LINE=$(git log -1 --pretty=format:%s 2>/dev/null)
STAMP_UTC=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SAFE_STAMP=$(echo "$STAMP_UTC" | tr ':' '-')
LOG_FILE="$LOG_DIR/commit-${COMMIT_SHA}-${SAFE_STAMP}.md"

LATEST_REPORT=$(ls -1t "$REPORT_DIR"/push-*.json 2>/dev/null | head -n 1)

{
  echo "# Dockium Commit Log"
  echo
  echo "- Timestamp (UTC): $STAMP_UTC"
  echo "- Branch: $BRANCH_NAME"
  echo "- Commit: $COMMIT_FULL"
  echo "- Author: $AUTHOR_LINE"
  echo "- Subject: $SUBJECT_LINE"
  echo
  echo "## Diff"
  echo '\`\`\`diff'
  git show --pretty=format: --no-color HEAD
  echo '\`\`\`'
  echo
  echo "## Latest Dockium Report Snapshot"
  if [ -n "$LATEST_REPORT" ]; then
    echo "- Source: $LATEST_REPORT"
    echo '\`\`\`json'
    sed -n '1,220p' "$LATEST_REPORT"
    echo '\`\`\`'
  else
    echo "No Dockium report found under .dockium/reports."
  fi
} > "$LOG_FILE"

echo "[DOCKIUM] Commit log written: $LOG_FILE"
exit 0
`

    fs.writeFileSync(postCommitHookPath, postCommitHookScript)
    fs.chmodSync(postCommitHookPath, 0o755)
    console.log(`[GitHookInstaller] Post-commit hook installed at ${postCommitHookPath}`)
  }

  async remove(repoPath) {
    const prePushHookPath = path.join(repoPath, '.git', 'hooks', 'pre-push')
    if (fs.existsSync(prePushHookPath)) {
      fs.unlinkSync(prePushHookPath)
      console.log('[GitHookInstaller] Pre-push hook removed')
    }

    const postCommitHookPath = path.join(repoPath, '.git', 'hooks', 'post-commit')
    if (fs.existsSync(postCommitHookPath)) {
      fs.unlinkSync(postCommitHookPath)
      console.log('[GitHookInstaller] Post-commit hook removed')
    }
  }

  async isInstalled(repoPath) {
    const hookPath = path.join(repoPath, '.git', 'hooks', 'pre-push')
    return fs.existsSync(hookPath)
  }
}

export default GitHookInstaller
