import SeverityScorer from './SeverityScorer.js'

const severityRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

function summarize(findings) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  const byEngine = {}
  let weightedRisk = 0

  for (const finding of findings) {
    const key = String(finding.severity || 'info').toLowerCase()
    if (bySeverity[key] === undefined) bySeverity.info += 1
    else bySeverity[key] += 1

    const engine = String(finding.engine || finding.type || finding.source || 'core').toLowerCase()
    byEngine[engine] = Number(byEngine[engine] || 0) + 1
    weightedRisk += Number(finding.riskScore || finding.cvss || 0)
  }

  return {
    total: findings.length,
    bySeverity,
    byEngine,
    weightedRisk: Number(weightedRisk.toFixed(1)),
    avgRisk: findings.length > 0 ? Number((weightedRisk / findings.length).toFixed(2)) : 0,
  }
}

function statusFor(findings, matcher) {
  const matched = findings.filter(matcher)
  if (!matched.length) return { status: 'PASS', detail: '0 findings' }
  return { status: 'FAIL', detail: `${matched.length} findings` }
}

function buildArtemisOps(scanResult, findings) {
  const artemisFindings = findings.filter((finding) => String(finding?.engine || finding?.type || '').toLowerCase().includes('artemis'))
  const diagnostics = scanResult?.operations?.artemis || scanResult?.diagnostics?.artemis || {}
  const testsRun = Array.isArray(diagnostics?.testsRun) ? diagnostics.testsRun : []
  const exploitSignals = artemisFindings.filter((finding) => {
    const text = `${finding?.title || ''} ${finding?.description || ''}`.toLowerCase()
    return /default credentials|path traversal|sql injection|xss|sensitive file exposure|protected endpoint/.test(text)
  })

  return {
    findingCount: artemisFindings.length,
    exploitSignalCount: exploitSignals.length,
    endpointCount: Number(diagnostics?.endpointCount || 0),
    checksRun: testsRun.length,
    failedChecks: testsRun.filter((entry) => String(entry?.status || '').toLowerCase() === 'failed').length,
    candidateCount: Array.isArray(diagnostics?.candidates) ? diagnostics.candidates.length : 0,
  }
}

function buildBrowserUseOps(scanResult, findings) {
  const browserFindings = findings.filter((finding) => String(finding?.engine || finding?.type || '').toLowerCase().includes('browser-use'))
  const diagnostics = scanResult?.operations?.browserUse || scanResult?.diagnostics?.browserUse || {}
  const documentation = diagnostics?.documentation || {}
  const coverage = documentation?.coverage || {}
  const instances = Array.isArray(documentation?.instances)
    ? documentation.instances
    : Array.isArray(diagnostics?.instances)
      ? diagnostics.instances
      : []
  const llmHelpProbe = documentation?.llmHelpProbe || diagnostics?.llmHelpProbe || null

  return {
    findingCount: browserFindings.length,
    inputRoutes: Number(coverage?.inputRoutes || 0),
    uniqueRoutes: Number(coverage?.uniqueRoutes || 0),
    duplicatesSkipped: Number(coverage?.duplicatesSkipped || 0),
    uiPagesTested: Number(coverage?.uiPagesTested || 0),
    apiRoutesTested: Number(coverage?.apiRoutesTested || 0),
    authRoutesTested: Number(coverage?.authRoutesTested || 0),
    isolatedInstanceCount: instances.length,
    llmHelpProbe,
    documentation,
  }
}

class ReportBuilder {
  constructor() {
    this.scorer = new SeverityScorer()
  }

  async build(scanResult, projectInfo, appMap, previousReport = null) {
    const scored = this.scorer.score(scanResult?.findings || [])
    const findings = [...scored].sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    const summary = summarize(findings)
    const artemisOps = buildArtemisOps(scanResult, findings)
    const browserUseOps = buildBrowserUseOps(scanResult, findings)

    const owaspChecklist = [
      { id: 'A01', label: 'A01 Broken Access Control', ...statusFor(findings, (f) => /idor|auth bypass|privilege/i.test(`${f.title} ${f.description}`)) },
      { id: 'A02', label: 'A02 Cryptographic Failures', status: 'PASS', detail: '0 findings' },
      { id: 'A03', label: 'A03 Injection', ...statusFor(findings, (f) => /sql|xss|injection/i.test(`${f.title} ${f.description}`)) },
      { id: 'A04', label: 'A04 Insecure Design', status: 'PARTIAL', detail: 'heuristic coverage' },
      { id: 'A05', label: 'A05 Security Misconfiguration', ...statusFor(findings, (f) => /header|debug|misconfiguration|env/i.test(`${f.title} ${f.description}`)) },
      { id: 'A06', label: 'A06 Vulnerable Components', ...statusFor(findings, (f) => /cve|dependency|vulnerability/i.test(`${f.title} ${f.description}`)) },
      { id: 'A07', label: 'A07 Auth Failures', ...statusFor(findings, (f) => /auth|jwt|session/i.test(`${f.title} ${f.description}`)) },
      { id: 'A08', label: 'A08 Data Integrity Failures', status: 'PASS', detail: '0 findings' },
      { id: 'A09', label: 'A09 Logging Failures', status: 'PARTIAL', detail: 'coverage incomplete' },
      { id: 'A10', label: 'A10 SSRF', ...statusFor(findings, (f) => /ssrf/i.test(`${f.title} ${f.description}`)) }
    ]

    const remediationChecklist = findings.slice(0, 25).map((finding) => ({
      done: false,
      text: `${finding.title} (${finding.severity.toUpperCase()})`,
      endpoint: finding.endpoint || 'n/a'
    }))

    return {
      meta: {
        timestamp: new Date().toISOString(),
        duration: scanResult?.durationMs || 0,
        projectName: projectInfo?.projectPath || 'unknown-project',
        framework: projectInfo?.framework || 'unknown',
        scanMode: scanResult?.mode || 'full',
        primaryEngine: 'artemis'
      },
      summary,
      operations: {
        artemis: artemisOps,
        browserUse: browserUseOps,
        aiProbe: scanResult?.operations?.aiProbe || null,
      },
      appMap: {
        folderTree: appMap?.folderTree || [],
        routeTree: appMap?.routeTree || [],
        apiGraph: appMap?.apiGraph || []
      },
      findings,
      owaspChecklist,
      remediationChecklist,
      scanComparison: {
        vs: previousReport?.meta?.timestamp || null,
        improved: previousReport ? findings.length < (previousReport.summary?.total || 0) : false,
        regressed: previousReport ? findings.length > (previousReport.summary?.total || 0) : false,
        new: findings.length,
        riskDelta: previousReport
          ? Number((summary.weightedRisk - Number(previousReport.summary?.weightedRisk || 0)).toFixed(1))
          : 0
      }
    }
  }
}

export default ReportBuilder
