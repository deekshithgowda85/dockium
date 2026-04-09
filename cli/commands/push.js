import simpleGit from 'simple-git'
import GitGate from '../../electron/core/git/GitGate.js'
import LiveBridge from '../lib/liveBridge.js'

async function pushNoVerify(git, remote, branch) {
  return await git.raw(['push', '--no-verify', remote, branch])
}

async function getAheadCount(git, remote, branch) {
  try {
    const raw = await git.raw(['rev-list', '--count', `${remote}/${branch}..HEAD`])
    const parsed = Number.parseInt(String(raw || '').trim(), 10)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  } catch {
    // remote branch might not exist yet
  }
  return 0
}

async function maybeAutoCommit(git, options = {}) {
  const autoCommit = options?.autoCommit === true
  const commitMessage = String(options?.commitMessage || 'chore: dockium auto commit').trim() || 'chore: dockium auto commit'
  const status = await git.status()
  const dirty = Array.isArray(status?.files) && status.files.length > 0

  if (!dirty) {
    return { committed: false, commitMessage: '', dirty: false }
  }

  if (!autoCommit) {
    return { committed: false, commitMessage: '', dirty: true }
  }

  await git.add(['-A'])
  const commitResult = await git.commit(commitMessage)
  return {
    committed: true,
    commitMessage,
    dirty: false,
    commit: String(commitResult?.commit || ''),
  }
}

function isReportArtifactPath(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/').trim().toLowerCase()
  if (!normalized) {
    return false
  }

  if (normalized.startsWith('.dockium/reports/')) {
    return true
  }

  return /^dockium-report-.*\.(docx|pdf|md|json)$/i.test(normalized)
}

async function listUnpushedFiles(git, remote, branch) {
  const candidates = [
    `${remote}/${branch}...HEAD`,
    `${remote}/${branch}..HEAD`,
    'HEAD~1..HEAD',
  ]

  for (const range of candidates) {
    try {
      const raw = await git.raw(['diff', '--name-only', range, '--'])
      const files = String(raw || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (files.length > 0) {
        return files
      }
    } catch {
      // try next range
    }
  }

  return []
}

function printFindings(findings = []) {
  const list = Array.isArray(findings) ? findings : []
  if (list.length === 0) {
    console.log('[DOCKIUM] No findings')
    return
  }

  for (const finding of list) {
    const severity = String(finding?.severity || 'info').toUpperCase()
    const type = String(finding?.type || finding?.title || 'Finding')
    const endpoint = String(finding?.endpoint || finding?.route || '-')
    console.log(`  [${severity}] ${type} - ${endpoint}`)
  }
}

async function resolveBranch(repoPath, explicitBranch) {
  if (explicitBranch) {
    return String(explicitBranch)
  }

  const git = simpleGit(repoPath)
  try {
    const status = await git.status()
    return String(status?.current || 'main')
  } catch {
    return 'main'
  }
}

async function push(options = {}) {
  const repoPath = process.cwd()
  const remote = String(options?.remote || 'origin')
  const branch = await resolveBranch(repoPath, options?.branch)
  const skipGate = options?.skipGate === true
  const enforceGate = options?.enforceGate === true
  const allowReportArtifacts = options?.allowReportArtifacts === true
  const autoCommit = options?.autoCommit === true
  const bridge = new LiveBridge()

  await bridge.connect()
  bridge.emit('gitgate:start', {
    timestamp: new Date().toISOString(),
    branch,
    remote,
    mode: skipGate ? 'skip-gate' : 'gate-and-push',
  })

  console.log(`[DOCKIUM] Pushing ${branch} -> ${remote}`)

  const git = simpleGit(repoPath)
  try {
    const autoCommitResult = await maybeAutoCommit(git, options)
    if (autoCommitResult.committed) {
      console.log(`[DOCKIUM] Auto-committed changes: ${autoCommitResult.commit || 'new commit created'} (${autoCommitResult.commitMessage})`)
    } else if (autoCommitResult.dirty && !autoCommit) {
      console.warn('[DOCKIUM] Working tree has uncommitted changes. Commit them first, or use --auto-commit.')
    }

    const aheadCount = await getAheadCount(git, remote, branch)
    if (aheadCount <= 0) {
      console.log(`[DOCKIUM] No local commits ahead of ${remote}/${branch}. Nothing to push.`)
      bridge.emit('gitgate:log', {
        timestamp: new Date().toISOString(),
        level: 'info',
        step: 'pre-push',
        message: `No local commits ahead of ${remote}/${branch}`,
      })
      bridge.emit('gitgate:result', {
        timestamp: new Date().toISOString(),
        branch,
        commitSha: 'unknown',
        commitMessage: 'no-op push',
        changedFiles: [],
        findings: [],
        testsPassed: true,
        durationMs: 0,
        blocked: false,
        allowed: true,
        reason: `Nothing to push: no commits ahead of ${remote}/${branch}`,
      })
      return
    }

    console.log(`[DOCKIUM] Local commits ahead of ${remote}/${branch}: ${aheadCount}`)

    const unpushedFiles = await listUnpushedFiles(git, remote, branch)
    const reportArtifacts = unpushedFiles.filter((filePath) => isReportArtifactPath(filePath))
    if (reportArtifacts.length > 0 && !allowReportArtifacts) {
      const detail = `Report artifacts detected in unpushed commits: ${reportArtifacts.join(', ')}`
      console.error('[DOCKIUM] Push blocked: report artifact files detected.')
      console.error('[DOCKIUM] Remove them from commit history or re-run with --allow-report-artifacts if intentional.')
      bridge.emit('gitgate:log', {
        timestamp: new Date().toISOString(),
        level: 'error',
        step: 'artifact-guard',
        message: detail,
      })
      bridge.emit('gitgate:result', {
        timestamp: new Date().toISOString(),
        branch,
        commitSha: 'unknown',
        commitMessage: 'artifact guard blocked push',
        changedFiles: reportArtifacts,
        findings: [],
        testsPassed: true,
        durationMs: 0,
        blocked: true,
        allowed: false,
        reason: detail,
      })
      process.exit(1)
      return
    }

    if (skipGate) {
      const skipMessage = 'Skipping gate check by user request'
      console.log(`[DOCKIUM] ${skipMessage}`)
      bridge.emit('gitgate:log', {
        timestamp: new Date().toISOString(),
        level: 'warn',
        step: 'skip-gate',
        message: skipMessage,
      })

      try {
        const pushOutput = await pushNoVerify(git, remote, branch)
        if (/everything up-to-date/i.test(String(pushOutput || ''))) {
          console.log(`[DOCKIUM] No updates were pushed to ${remote}/${branch}.`)
        }
      } catch (error) {
        const detail = String(error?.message || error)
        console.error(`[DOCKIUM] Push failed: ${detail}`)
        if (/permission|403|denied/i.test(detail)) {
          console.error('[DOCKIUM] Hint: push to your own fork remote, or use --remote pointing to a writable remote.')
        }
        bridge.emit('gitgate:log', {
          timestamp: new Date().toISOString(),
          level: 'error',
          step: 'git-push',
          message: detail,
        })
        bridge.emit('gitgate:result', {
          timestamp: new Date().toISOString(),
          branch,
          commitSha: 'unknown',
          commitMessage: 'gate skipped',
          changedFiles: [],
          findings: [],
          testsPassed: true,
          durationMs: 0,
          blocked: true,
          allowed: false,
          reason: `Push failed: ${detail}`,
        })
        process.exit(1)
        return
      }
      console.log(`[DOCKIUM] Done. ${remote}/${branch} updated.`)
      bridge.emit('gitgate:result', {
        timestamp: new Date().toISOString(),
        branch,
        commitSha: 'unknown',
        commitMessage: 'gate skipped',
        changedFiles: [],
        findings: [],
        testsPassed: true,
        durationMs: 0,
        blocked: false,
        allowed: true,
        reason: 'Gate skipped by user option',
      })
      return
    }

    console.log('[DOCKIUM] Running gate check...')
    const gate = new GitGate(null, repoPath)

    let result
    try {
      result = await gate.check('HEAD~1', {
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
    } catch (error) {
      const detail = String(error?.message || error)
      console.error(`[DOCKIUM] Gate check failed: ${detail}`)
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
        reason: `Gate check failed: ${detail}`,
      })
      process.exit(1)
      return
    }

    const normalizedResult = {
      ...result,
      timestamp: result.timestamp || new Date().toISOString(),
      branch,
      allowed: !result.blocked,
    }

    if (result.blocked) {
      if (enforceGate) {
        console.log('[DOCKIUM] Push BLOCKED')
        console.log(`Reason: ${result.reason || 'Gate blocked'}`)
        printFindings(result.findings)
        process.exit(1)
        return
      }

      const warnMessage = 'Gate reported blockers, continuing push in warn-only mode. Use --enforce-gate to block.'
      console.warn(`[DOCKIUM] ${warnMessage}`)
      console.log(`Reason: ${result.reason || 'Gate blocked'}`)
      printFindings(result.findings)
      bridge.emit('gitgate:log', {
        timestamp: new Date().toISOString(),
        level: 'warn',
        step: 'gate-policy',
        message: warnMessage,
      })
      normalizedResult.blocked = false
      normalizedResult.allowed = true
      normalizedResult.reason = `${result.reason || 'Gate blocked'} (warn-only: push forwarded)`
    }

    bridge.emit('gitgate:result', normalizedResult)

    console.log('[DOCKIUM] Gate complete - pushing...')
    try {
      const pushOutput = await pushNoVerify(git, remote, branch)
      if (/everything up-to-date/i.test(String(pushOutput || ''))) {
        console.log(`[DOCKIUM] No updates were pushed to ${remote}/${branch}.`)
      }
    } catch (error) {
      const detail = String(error?.message || error)
      console.error(`[DOCKIUM] Push failed: ${detail}`)
      if (/permission|403|denied/i.test(detail)) {
        console.error('[DOCKIUM] Hint: push to your own fork remote, or use --remote pointing to a writable remote.')
      }
      bridge.emit('gitgate:log', {
        timestamp: new Date().toISOString(),
        level: 'error',
        step: 'git-push',
        message: detail,
      })
      bridge.emit('gitgate:result', {
        timestamp: new Date().toISOString(),
        branch,
        commitSha: result?.commitSha || 'unknown',
        commitMessage: result?.commitMessage || 'unknown',
        changedFiles: Array.isArray(result?.changedFiles) ? result.changedFiles : [],
        findings: Array.isArray(result?.findings) ? result.findings : [],
        testsPassed: result?.testsPassed !== false,
        durationMs: Number(result?.durationMs || 0),
        blocked: true,
        allowed: false,
        reason: `Push failed: ${detail}`,
      })
      process.exit(1)
      return
    }
    console.log(`[DOCKIUM] Done. ${remote}/${branch} updated.`)
  } finally {
    bridge.close()
  }
}

export default push
