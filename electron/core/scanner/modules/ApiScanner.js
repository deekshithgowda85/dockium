import fetch from 'node-fetch'

class ApiScanner {
  constructor(config) {
    this.config = config
    this.targetUrl = config.project.targetUrl
    this.payloads = [
      "' OR 1=1--",
      "<script>alert(1)</script>",
      '../../etc/passwd'
    ]
  }

  isApiOrRestPath(pathValue) {
    const path = String(pathValue || '/').toLowerCase()
    return path === '/api' || path.startsWith('/api/') || path === '/rest' || path.startsWith('/rest/')
  }

  async scan(endpoints) {
    console.log(`[ApiScanner] Scanning ${endpoints.length} endpoints`)
    const findings = []

    for (const endpoint of endpoints) {
      if (this.isApiOrRestPath(endpoint?.path)) {
        continue
      }

      try {
        const result = await this.testEndpoint(endpoint)
        if (result.findings) {
          findings.push(...result.findings)
        }
      } catch (e) {
        console.error(`[ApiScanner] Error testing ${endpoint.path}:`, e.message)
      }
    }

    return findings
  }

  async testEndpoint(endpoint) {
    const findings = []
    const method = String(endpoint.method || 'GET').toUpperCase()
    const rawPath = endpoint.path || '/'
    const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
    const baseUrl = `${this.targetUrl}${normalizedPath.replace(/:id/g, '1')}`

    for (const payload of this.payloads) {
      const url = method === 'GET'
        ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}q=${encodeURIComponent(payload)}`
        : baseUrl

      const options = {
        method,
        headers: { 'content-type': 'application/json' }
      }

      if (method !== 'GET') {
        options.body = JSON.stringify({ q: payload, input: payload })
      }

      try {
        const response = await fetch(url, options)
        const body = await response.text()

        if (response.status >= 500 && /(sql|syntax|database|query|exception)/i.test(body)) {
          findings.push({
            type: 'API',
            severity: 'critical',
            title: 'Potential SQL/Server Injection Error',
            description: `Server error pattern detected on ${method} ${normalizedPath}`,
            endpoint: normalizedPath,
            method,
            payload,
            response: `${response.status}`,
            fix: 'Use parameterized queries and sanitize untrusted input.'
          })
        }

        if (payload.includes('<script') && body.includes(payload)) {
          findings.push({
            type: 'API',
            severity: 'high',
            title: 'Reflected XSS Pattern',
            description: `Payload reflected in response for ${method} ${normalizedPath}`,
            endpoint: normalizedPath,
            method,
            payload,
            response: `${response.status}`,
            fix: 'HTML-escape output and validate request input.'
          })
        }
      } catch {
        // Ignore unreachable endpoints and continue scanning others.
      }
    }

    return { findings }
  }
}

export default ApiScanner
