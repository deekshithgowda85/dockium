import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import simpleGit from 'simple-git'
import SecretsScanner from '../scanner/modules/SecretsScanner.js'
import ScanOrchestrator from '../scanner/ScanOrchestrator.js'
import DiffAnalyzer from './DiffAnalyzer.js'
import RemoteForwarder from './RemoteForwarder.js'

const execAsync = promisify(exec)
const DEFAULT_BLOCK_ON = ['critical', 'high']
const DEFAULT_TEST_COMMAND = 'npm test'

class GitGate {
  constructor(config, repoPath) {
    this.config = config || null
    this.repoPath = repoPath
    this.secretsScanner = null
    this.scanOrchestrator = null
    this.diffAnalyzer = new DiffAnalyzer()
    this.remoteForwarder = new RemoteForwarder()
  }

  async loadConfig(repoPath = this.repoPath) {
    const configPath = path.join(repoPath, '.dockium', 'config.json')
    let fileConfig = null

    try {
      if (fs.existsSync(configPath)) {
        fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      }
    } catch {
      fileConfig = null
    }

    const merged = {
      ...(this.config || {}),
      ...(fileConfig || {}),
      project: {
        ...((this.config && this.config.project) || {}),
        ...((fileConfig && fileConfig.project) || {}),
      },
      gitGate: {
        ...((this.config && this.config.gitGate) || {}),
        ...((fileConfig && fileConfig.gitGate) || {}),
      },
    }

    merged.project = {
      name: merged.project?.name || path.basename(repoPath || ''),
      path: merged.project?.path || repoPath,
      targetUrl: merged.project?.targetUrl || '',
      appPort: Number(merged.project?.appPort || 3000),
      testCommand: String(merged.project?.testCommand || DEFAULT_TEST_COMMAND),
    }

    const blockOnArray = Array.isArray(merged.gitGate?.blockOn)
      ? merged.gitGate.blockOn.map((entry) => String(entry || '').toLowerCase()).filter(Boolean)
      : []

    const inferredBlockOn = []
    if (merged.gitGate?.blockCritical === true) inferredBlockOn.push('critical')
    if (merged.gitGate?.blockHigh === true) inferredBlockOn.push('high')
    if (merged.gitGate?.blockMedium === true) inferredBlockOn.push('medium')

    merged.gitGate = {
      enabled: merged.gitGate?.enabled !== false,
      blockOn: blockOnArray.length > 0 ? blockOnArray : (inferredBlockOn.length > 0 ? inferredBlockOn : DEFAULT_BLOCK_ON),
      blockOnSecrets: merged.gitGate?.blockOnSecrets !== false,
      blockOnTestFailure: merged.gitGate?.blockOnTestFailure !== false,
      threshold: Number(merged.gitGate?.threshold || 1),
    }

    this.config = merged
    this.secretsScanner = new SecretsScanner(merged)
    this.scanOrchestrator = new ScanOrchestrator(merged)
    return merged
  }

  async saveReport(repoPath, result) {
    const reportsDir = path.join(repoPath, '.dockium', 'reports')
    fs.mkdirSync(reportsDir, { recursive: true })
    const commit = String(result?.commitSha || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown'
    const reportFile = `push-${commit}-${Date.now()}.json`
    const reportPath = path.join(reportsDir, reportFile)
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8')
    return reportPath
  }

  emitProgress(options = {}, message = '', level = 'info', step = '') {
    if (typeof options.onLog === 'function') {
      options.onLog({ message, level, step })
    }
  }

  async check(pushRef = 'HEAD~1', options = {}) {
    const config = await this.loadConfig(this.repoPath)
    const startedAt = Date.now()
    const branch = options.branch || await this.getCurrentBranch()
    const findings = []
    let diff = {
      diffString: '',
      changedFiles: [],
      newRoutes: [],
      commitSha: 'unknown',
      commitMessage: 'unknown',
    }
    let tests = { ok: true }

    this.emitProgress(options, '[Gate] Step 1/5: Analyzing diff...')
    diff = await this.diffAnalyzer.analyze(this.repoPath, pushRef)

    this.emitProgress(options, '[Gate] Step 2/5: Scanning for secrets...')
    let secretsFindings = []
    try {
      secretsFindings = await this.secretsScanner.scanDiff(diff.diffString)
    } catch {
      secretsFindings = []
    }
    findings.push(...secretsFindings)

    this.emitProgress(options, '[Gate] Step 3/5: Running security scan...')
    let fastScan = { findings: [] }
    try {
      fastScan = await this.scanOrchestrator.run('quick', ['infra', 'api'])
    } catch {
      fastScan = { findings: [] }
    }
    findings.push(...(Array.isArray(fastScan?.findings) ? fastScan.findings : []))

    this.emitProgress(options, '[Gate] Step 4/5: Running test suite...')
    tests = await this.runTests()

    const reasons = []
    if (this.shouldBlockBySeverity(findings)) reasons.push('findings threshold reached')
    if (config?.gitGate?.blockOnSecrets && secretsFindings.length) reasons.push('secrets detected')
    if (config?.gitGate?.blockOnTestFailure && !tests.ok) reasons.push('tests failed')

    const blocked = reasons.length > 0
    const durationMs = Date.now() - startedAt

    this.emitProgress(options, '[Gate] Step 5/5: Documenting results...')

    const result = {
      timestamp: new Date().toISOString(),
      branch,
      commitSha: diff.commitSha,
      commitMessage: diff.commitMessage,
      changedFiles: diff.changedFiles,
      newRoutes: diff.newRoutes,
      findings,
      testsPassed: Boolean(tests.ok),
      durationMs,
      blocked,
      allowed: !blocked,
      reason: blocked ? `Gate blocked: ${reasons.join(', ')}` : 'Gate passed',
      diffString: diff.diffString,
    }

    if (options.persistReport !== false) {
      try {
        result.reportPath = await this.saveReport(this.repoPath, result)
      } catch {
        result.reportPath = ''
      }
    }

    return result
  }

  async checkAndPush(options = {}) {
    const gateResult = await this.check(options.pushRef || 'HEAD~1', options)

    if (gateResult.blocked && !options.skipGate) {
      return gateResult
    }

    const remote = options.remote || 'origin'
    const branch = options.branch || gateResult.branch || await this.getCurrentBranch()
    await this.remoteForwarder.forward(this.repoPath, remote, branch)
    return {
      ...gateResult,
      blocked: false,
      allowed: true,
      reason: options.skipGate ? 'Gate skipped by user option' : 'Gate passed and push forwarded',
      remote,
    }
  }

  shouldBlockBySeverity(findings) {
    const blockOn = Array.isArray(this.config?.gitGate?.blockOn)
      ? this.config.gitGate.blockOn.map((entry) => String(entry || '').toLowerCase())
      : DEFAULT_BLOCK_ON
    return findings.some((finding) => blockOn.includes(String(finding.severity || '').toLowerCase()))
  }

  async runTests() {
    const testCommand = String(this.config?.project?.testCommand || DEFAULT_TEST_COMMAND).trim() || DEFAULT_TEST_COMMAND
    try {
      await execAsync(testCommand, { cwd: this.repoPath, timeout: 120000 })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error?.message || 'Test command failed' }
    }
  }

  async getCurrentBranch() {
    try {
      const git = simpleGit(this.repoPath)
      const status = await git.status()
      return String(status?.current || 'unknown')
    } catch {
      return 'unknown'
    }
  }
}

export default GitGate
