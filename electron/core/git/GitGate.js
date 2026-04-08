import { exec } from 'child_process'
import { promisify } from 'util'
import SecretsScanner from '../scanner/modules/SecretsScanner.js'
import ScanOrchestrator from '../scanner/ScanOrchestrator.js'
import DiffAnalyzer from './DiffAnalyzer.js'
import RemoteForwarder from './RemoteForwarder.js'

const execAsync = promisify(exec)

class GitGate {
  constructor(config, repoPath) {
    this.config = config
    this.repoPath = repoPath
    this.secretsScanner = new SecretsScanner(config)
    this.scanOrchestrator = new ScanOrchestrator(config)
    this.diffAnalyzer = new DiffAnalyzer()
    this.remoteForwarder = new RemoteForwarder()
  }

  async check(pushRef = 'HEAD~1') {
    console.log('[GitGate] Starting gate check')
    const findings = []

    try {
      const diff = await this.diffAnalyzer.analyze(this.repoPath, pushRef)

      const secretsFindings = await this.secretsScanner.scanDiff(diff.diffString)
      findings.push(...secretsFindings)

      const fastScan = await this.scanOrchestrator.run('quick', ['infra', 'api'])
      findings.push(...(fastScan.findings || []))

      const tests = await this.runTests()

      const reasons = []
      if (this.shouldBlockBySeverity(findings)) reasons.push('findings threshold reached')
      if (this.config?.gitGate?.blockOnSecrets && secretsFindings.length) reasons.push('secrets detected')
      if (this.config?.gitGate?.blockOnTestFailure && !tests.ok) reasons.push('tests failed')

      if (reasons.length > 0) {
        return {
          blocked: true,
          findings,
          reason: `Gate blocked: ${reasons.join(', ')}`,
          diffString: diff.diffString,
          changedFiles: diff.changedFiles,
          newRoutes: diff.newRoutes,
          commitSha: diff.commitSha,
          commitMessage: diff.commitMessage
        }
      }

      return {
        blocked: false,
        findings,
        diffString: diff.diffString,
        changedFiles: diff.changedFiles,
        newRoutes: diff.newRoutes,
        commitSha: diff.commitSha,
        commitMessage: diff.commitMessage
      }
    } catch (e) {
      console.error('[GitGate] Error:', e.message)
      throw e
    }
  }

  async checkAndPush(options = {}) {
    const gateResult = await this.check(options.pushRef || 'HEAD~1')

    if (gateResult.blocked && !options.skipGate) {
      return gateResult
    }

    if (options.skipGate) {
      console.warn('[GitGate] Skipping gate - pushing directly')
    }

    const remote = options.remote || 'origin'
    const branch = options.branch || (await this.getCurrentBranch())
    await this.remoteForwarder.forward(this.repoPath, remote, branch)
    return { blocked: false, findings: gateResult.findings || [] }
  }

  shouldBlockBySeverity(findings) {
    const blockOn = this.config?.gitGate?.blockOn || ['critical', 'high']
    return findings.some((finding) => blockOn.includes(String(finding.severity || '').toLowerCase()))
  }

  async runTests() {
    const testCommand = this.config?.project?.testCommand || 'npm test'
    try {
      await execAsync(testCommand, { cwd: this.repoPath, timeout: 120000 })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }

  async getCurrentBranch() {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: this.repoPath })
    return stdout.trim()
  }
}

export default GitGate
