function cvssFromSeverity(severity) {
  if (severity === 'critical') return 9.4
  if (severity === 'high') return 8.2
  if (severity === 'medium') return 5.8
  if (severity === 'low') return 3.4
  return 1.0
}

function classifyFinding(finding) {
  const text = `${finding.title || ''} ${finding.description || ''}`.toLowerCase()
  if (/sqli|sql injection|auth bypass|secret|unauthenticated admin/.test(text)) return 'critical'
  if (/idor|xss|ssrf|path traversal/.test(text)) return 'high'
  if (/header|rate limiting|misconfiguration|debug|exposed/.test(text)) return 'medium'
  if (/verbose|x-content-type-options|info/.test(text)) return 'low'
  return String(finding.severity || 'info').toLowerCase()
}

class SeverityScorer {
  score(findings) {
    return (findings || []).map((finding) => {
      const severity = classifyFinding(finding)
      return {
        ...finding,
        severity,
        cvss: cvssFromSeverity(severity)
      }
    })
  }
}

export default SeverityScorer
