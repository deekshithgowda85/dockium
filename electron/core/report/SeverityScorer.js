function cvssFromSeverity(severity) {
  if (severity === 'critical') return 9.4
  if (severity === 'high') return 8.2
  if (severity === 'medium') return 5.8
  if (severity === 'low') return 3.4
  return 1.0
}

const severityRank = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
}

function normalizeSeverity(value) {
  const key = String(value || 'info').toLowerCase()
  if (severityRank[key] !== undefined) {
    return key
  }
  return 'info'
}

function severityFromRank(rank) {
  const clamped = Math.max(0, Math.min(4, Number(rank || 0)))
  if (clamped >= 4) return 'critical'
  if (clamped === 3) return 'high'
  if (clamped === 2) return 'medium'
  if (clamped === 1) return 'low'
  return 'info'
}

function pickHigherSeverity(left, right) {
  const leftKey = normalizeSeverity(left)
  const rightKey = normalizeSeverity(right)
  return severityRank[leftKey] >= severityRank[rightKey] ? leftKey : rightKey
}

function classifyFinding(finding) {
  const text = `${finding.title || ''} ${finding.description || ''}`.toLowerCase()
  if (/sqli|sql injection|auth bypass|secret|unauthenticated admin/.test(text)) return 'critical'
  if (/idor|xss|ssrf|path traversal/.test(text)) return 'high'
  if (/header|rate limiting|misconfiguration|debug|exposed/.test(text)) return 'medium'
  if (/verbose|x-content-type-options|info/.test(text)) return 'low'
  return String(finding.severity || 'info').toLowerCase()
}

function isArtemisFinding(finding) {
  const tags = `${finding?.engine || ''} ${finding?.source || ''} ${finding?.type || ''} ${finding?.title || ''}`.toLowerCase()
  return /artemis/.test(tags)
}

function artemisSeverityAdjustment(finding) {
  const text = `${finding.title || ''} ${finding.description || ''} ${finding.proof || ''}`.toLowerCase()
  if (/scan diagnostics|artemis scan diagnostics|diagnostics/.test(text)) {
    return -4
  }

  if (/default credentials|path traversal|sensitive file exposure/.test(text)) {
    return 1
  }

  if (/protected endpoint may be reachable without valid auth|authz/.test(text)) {
    return 1
  }

  if (/possible sql injection|reflected xss|detailed error disclosure|cors allows wildcard origin with credentials/.test(text)) {
    return 1
  }

  return 0
}

function riskScoreFor(finding, severity) {
  let score = cvssFromSeverity(severity)
  const proof = String(finding?.proof || '').trim()
  const endpoint = String(finding?.endpoint || '')

  if (proof && proof !== 'n/a') {
    score += 0.5
  }

  if (/^https?:\/\//i.test(endpoint)) {
    score += 0.3
  }

  if (isArtemisFinding(finding)) {
    score += 0.4
  }

  return Math.min(10, Number(score.toFixed(1)))
}

class SeverityScorer {
  score(findings) {
    return (findings || []).map((finding) => {
      const inferredSeverity = classifyFinding(finding)
      const providedSeverity = normalizeSeverity(finding?.severity)
      let severity = pickHigherSeverity(inferredSeverity, providedSeverity)

      if (isArtemisFinding(finding)) {
        const adjustedRank = severityRank[severity] + artemisSeverityAdjustment(finding)
        severity = severityFromRank(adjustedRank)
      }

      const cvss = cvssFromSeverity(severity)
      return {
        ...finding,
        severity,
        cvss,
        riskScore: riskScoreFor(finding, severity),
        engine: isArtemisFinding(finding) ? 'artemis' : String(finding?.engine || 'core')
      }
    })
  }
}

export default SeverityScorer
