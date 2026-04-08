import fetch from 'node-fetch'

class AuthScanner {
  constructor(config) {
    this.config = config
    this.targetUrl = config.project.targetUrl
  }

  isApiOrRestPath(pathValue) {
    const path = String(pathValue || '/').toLowerCase()
    return path === '/api' || path.startsWith('/api/') || path === '/rest' || path.startsWith('/rest/')
  }

  async scan(endpoints) {
    console.log(`[AuthScanner] Scanning auth on ${endpoints.length} endpoints`)
    const findings = []

    for (const endpoint of endpoints) {
      if (this.isApiOrRestPath(endpoint?.path)) {
        continue
      }

      try {
        const issues = await this.checkAuthIssues(endpoint)
        findings.push(...issues)
      } catch (e) {
        console.error(`[AuthScanner] Error scanning ${endpoint.path}:`, e.message)
      }
    }

    return findings
  }

  async checkAuthIssues(endpoint) {
    const issues = []
    const path = String(endpoint.path || '/').replace(/:id/g, '1')
    const target = `${this.targetUrl}${path.startsWith('/') ? path : `/${path}`}`

    try {
      const response = await fetch(target, { method: String(endpoint.method || 'GET').toUpperCase() })
      if (endpoint.authRequired && response.status < 300) {
        issues.push({
          type: 'Auth',
          severity: 'critical',
          title: 'Auth Bypass Suspected',
          description: `Protected endpoint returned ${response.status} without credentials`,
          endpoint: endpoint.path,
          method: endpoint.method,
          response: `${response.status}`
        })
      }
    } catch {}

    // Check for missing authentication
    if (endpoint.authRequired === false && this.isSensitiveEndpoint(endpoint)) {
      issues.push({
        type: 'Auth',
        severity: 'high',
        title: 'Missing Authentication',
        description: `Endpoint ${endpoint.method} ${endpoint.path} does not require authentication`,
        endpoint: endpoint.path,
        method: endpoint.method
      })
    }

    // Check for IDOR (ID-based access control issues)
    if ((endpoint.acceptsId || (endpoint.params || []).includes('id')) && endpoint.authRequired === true) {
      issues.push({
        type: 'Auth',
        severity: 'high',
        title: 'Potential IDOR Vulnerability',
        description: `Endpoint ${endpoint.method} ${endpoint.path} accepts ID parameter - verify proper authorization`,
        endpoint: endpoint.path,
        method: endpoint.method
      })
    }

    return issues
  }

  isSensitiveEndpoint(endpoint) {
    const sensitivePatterns = [
      '/admin',
      '/user',
      '/profile',
      '/account',
      '/settings',
      '/data',
      '/report',
      '/payment',
      '/transaction'
    ]

    return sensitivePatterns.some(pattern =>
      endpoint.path.toLowerCase().includes(pattern)
    )
  }
}

export default AuthScanner
