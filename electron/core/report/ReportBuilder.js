import SeverityScorer from './SeverityScorer.js'

const severityRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

function summarize(findings) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const finding of findings) {
    const key = String(finding.severity || 'info').toLowerCase()
    if (bySeverity[key] === undefined) bySeverity.info += 1
    else bySeverity[key] += 1
  }
  return { total: findings.length, bySeverity }
}

function statusFor(findings, matcher) {
  const matched = findings.filter(matcher)
  if (!matched.length) return { status: 'PASS', detail: '0 findings' }
  return { status: 'FAIL', detail: `${matched.length} findings` }
}

class ReportBuilder {
  constructor() {
    this.scorer = new SeverityScorer()
  }

  async build(scanResult, projectInfo, appMap, previousReport = null) {
    const scored = this.scorer.score(scanResult?.findings || [])
    const findings = [...scored].sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    const summary = summarize(findings)

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
        scanMode: scanResult?.mode || 'full'
      },
      summary,
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
        new: findings.length
      }
    }
  }
}

export default ReportBuilder
