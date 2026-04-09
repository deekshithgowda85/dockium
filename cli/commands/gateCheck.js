import simpleGit from 'simple-git'
import GitGate from '../../electron/core/git/GitGate.js'
import LiveBridge from '../lib/liveBridge.js'

async function currentBranch(repoPath) {
  const git = simpleGit(repoPath)
  try {
    const status = await git.status()
    return String(status?.current || 'unknown')
  } catch {
    return 'unknown'
  }
}

async function gateCheck() {
  const repoPath = process.cwd()
  const branch = await currentBranch(repoPath)
  const gate = new GitGate(null, repoPath)
  const bridge = new LiveBridge()

  await bridge.connect()
  bridge.emit('gitgate:start', {
    timestamp: new Date().toISOString(),
    branch,
    mode: 'hook-gate-check',
  })

  try {
    const result = await gate.check('HEAD~1', {
      branch,
      persistReport: true,
      onLog: ({ message, level, step }) => {
        if (message) {
          console.log(`[DOCKIUM] ${message}`)
          bridge.emit('gitgate:log', {
            timestamp: new Date().toISOString(),
            message,
            level: level || 'info',
            step: step || 'gate-check',
          })
        }
      },
    })

    bridge.emit('gitgate:result', {
      ...result,
      timestamp: result.timestamp || new Date().toISOString(),
      branch,
      allowed: !result.blocked,
    })

    if (result.blocked) {
      console.error(`[DOCKIUM] Gate blocked: ${result.reason || 'policy violation'}`)
      process.exit(1)
      return
    }

    process.exit(0)
  } catch (error) {
    const detail = String(error?.message || error)
    console.error(`[DOCKIUM] Gate execution error: ${detail}`)
    bridge.emit('gitgate:log', {
      timestamp: new Date().toISOString(),
      level: 'error',
      step: 'gate-check',
      message: detail,
    })
    bridge.emit('gitgate:result', {
      timestamp: new Date().toISOString(),
      branch,
      commitSha: 'unknown',
      commitMessage: 'unknown',
      changedFiles: [],
      findings: [],
      testsPassed: false,
      durationMs: 0,
      blocked: true,
      allowed: false,
      reason: `Gate execution error: ${detail}`,
    })
    process.exit(1)
  } finally {
    bridge.close()
  }
}

export default gateCheck
