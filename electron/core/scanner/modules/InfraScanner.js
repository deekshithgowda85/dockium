import fetch from 'node-fetch'

class InfraScanner {
  constructor(config) {
    this.config = config
    this.targetUrl = config.project.targetUrl
  }

  async scan() {
    console.log('[InfraScanner] Scanning infrastructure security')
    const findings = []

    // Check for missing security headers
    const headerFindings = await this.checkHeaders()
    findings.push(...headerFindings)

    // Check SSL/TLS configuration
    const sslFindings = await this.checkSSL()
    findings.push(...sslFindings)

    // Check CORS configuration
    const corsFindings = await this.checkCORS()
    findings.push(...corsFindings)

    // Check exposed config/debug endpoints
    const exposedFindings = await this.checkExposedFilesAndDebug()
    findings.push(...exposedFindings)

    // Check rate limiting
    const rateFindings = await this.checkRateLimit()
    findings.push(...rateFindings)

    return findings
  }

  async checkExposedFilesAndDebug() {
    const findings = []
    const probes = ['/.env', '/.env.local', '/.env.production', '/debug', '/__debug__', '/api/debug']

    for (const probe of probes) {
      try {
        const response = await fetch(`${this.targetUrl}${probe}`, { method: 'GET' })
        if (response.status === 200) {
          findings.push({
            type: 'Infrastructure',
            severity: probe.startsWith('/.env') ? 'critical' : 'high',
            title: `Exposed Endpoint: ${probe}`,
            description: `${probe} is publicly accessible with HTTP 200.`,
            endpoint: probe,
            fix: 'Remove public exposure or protect this endpoint.'
          })
        }
      } catch {
        // Ignore unavailable probe responses.
      }
    }

    return findings
  }

  async checkHeaders() {
    const findings = []

    // Check for missing HSTS, CSP, X-Frame-Options, etc.
    const requiredHeaders = [
      { name: 'Strict-Transport-Security', severity: 'high', title: 'Missing HSTS Header' },
      { name: 'Content-Security-Policy', severity: 'medium', title: 'Missing CSP Header' },
      { name: 'X-Frame-Options', severity: 'medium', title: 'Missing X-Frame-Options Header' },
      { name: 'X-Content-Type-Options', severity: 'medium', title: 'Missing X-Content-Type-Options Header' }
    ]

    try {
      const response = await fetch(this.targetUrl, { method: 'GET' })
      const headers = response.headers

      requiredHeaders.forEach((header) => {
        if (!headers.get(header.name)) {
          findings.push({
            type: 'Infrastructure',
            severity: header.severity,
            title: header.title,
            description: `${header.name} header is missing on main response.`,
            endpoint: this.targetUrl,
            fix: `Add ${header.name} to secure HTTP responses.`
          })
        }
      })
    } catch {
      // Target might not be available yet.
    }

    return findings
  }

  async checkSSL() {
    if (this.targetUrl.startsWith('https://')) {
      return []
    }

    return [{
      type: 'Infrastructure',
      severity: 'medium',
      title: 'HTTPS Not Enabled',
      description: 'Target URL is served over HTTP. Use TLS in production.',
      endpoint: this.targetUrl,
      fix: 'Enable HTTPS and enforce HSTS in production deployments.'
    }]
  }

  async checkCORS() {
    const findings = []

    try {
      const response = await fetch(this.targetUrl, {
        method: 'GET',
        headers: { origin: 'https://evil.example' }
      })

      if (response.headers.get('access-control-allow-origin') === '*') {
        findings.push({
          type: 'Infrastructure',
          severity: 'medium',
          title: 'Overly Permissive CORS',
          description: 'CORS allows any origin (*).',
          endpoint: this.targetUrl,
          fix: 'Restrict Access-Control-Allow-Origin to trusted origins.'
        })
      }
    } catch {
      // Ignore for offline target.
    }

    return findings
  }

  async checkRateLimit() {
    const target = `${this.targetUrl}/api/auth/login`
    let hit429 = false

    for (let i = 0; i < 12; i += 1) {
      try {
        const response = await fetch(target, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'dockium@test.local', password: 'bad-pass' })
        })

        if (response.status === 429) {
          hit429 = true
          break
        }
      } catch {
        break
      }
    }

    if (hit429) {
      return []
    }

    return [{
      type: 'Infrastructure',
      severity: 'medium',
      title: 'Rate Limiting Not Detected',
      description: 'No HTTP 429 responses observed on repeated auth attempts.',
      endpoint: '/api/auth/login',
      fix: 'Add per-IP and per-account rate limiting for auth endpoints.'
    }]
  }
}

export default InfraScanner
