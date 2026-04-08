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
    const hookScript = `#!/bin/sh
# DOCKIUM Pre-push Hook
# This hook intercepts git push and runs Dockium gate check

echo "[DOCKIUM] Running gate check before push..."
dockium gate-check "\$@"
RESULT=$?

if [ $RESULT -ne 0 ]; then
  echo "[DOCKIUM] Gate check failed - push blocked"
  exit 1
fi

echo "[DOCKIUM] Gate check passed - proceeding with push"
exit 0
`

    fs.writeFileSync(hookPath, hookScript)
    fs.chmodSync(hookPath, 0o755)

    console.log(`[GitHookInstaller] Pre-push hook installed at ${hookPath}`)
  }

  async remove(repoPath) {
    const hookPath = path.join(repoPath, '.git', 'hooks', 'pre-push')
    if (fs.existsSync(hookPath)) {
      fs.unlinkSync(hookPath)
      console.log('[GitHookInstaller] Pre-push hook removed')
    }
  }

  async isInstalled(repoPath) {
    const hookPath = path.join(repoPath, '.git', 'hooks', 'pre-push')
    return fs.existsSync(hookPath)
  }
}

export default GitHookInstaller
