import fetch from 'node-fetch'

class InputScanner {
  constructor(config) {
    this.config = config
    this.targetUrl = config.project.targetUrl
    this.payloads = {
      xss: [
        '<script>alert("xss")</script>',
        '"><script>alert("xss")</script>',
        '<svg onload=alert("xss")>',
        'javascript:alert("xss")',
        '<img src=x onerror=alert("xss")>'
      ],
      sqlInjection: [
        "' OR '1'='1",
        "' OR 1=1--",
        "' UNION SELECT NULL--",
        "admin'--",
        "' OR 'a'='a"
      ],
      commandInjection: [
        '`id`',
        '$(id)',
        '; id',
        '| id',
        '|| id'
      ],
      pathTraversal: [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\win.ini',
        '....//....//....//etc/passwd',
        '%2e%2e%2f%2e%2e%2fetc%2fpasswd'
      ]
    }
  }

  async scan(endpoints) {
    console.log(`[InputScanner] Fuzzing ${endpoints.length} endpoints`)
    const findings = []

    for (const endpoint of endpoints) {
      if (endpoint.method !== 'POST' && endpoint.method !== 'GET') {
        continue
      }

      try {
        const results = await this.fuzzEndpoint(endpoint)
        findings.push(...results)
      } catch (e) {
        console.error(`[InputScanner] Error fuzzing ${endpoint.path}:`, e.message)
      }
    }

    return findings
  }

  async fuzzEndpoint(endpoint) {
    const findings = []
    const method = String(endpoint.method || 'GET').toUpperCase()
    const rawPath = endpoint.path || '/'
    const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
    const baseUrl = `${this.targetUrl}${normalizedPath.replace(/:id/g, '1')}`

    for (const [type, payloads] of Object.entries(this.payloads)) {
      for (const payload of payloads) {
        const url = method === 'GET'
          ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}input=${encodeURIComponent(payload)}`
          : baseUrl

        const options = {
          method,
          headers: { 'content-type': 'application/json' }
        }

        if (method !== 'GET') {
          options.body = JSON.stringify({ input: payload, value: payload })
        }

        try {
          const response = await fetch(url, options)
          const body = await response.text()
          const reflected = body.includes(payload)
          const errorLike = /(syntax|exception|traceback|sql|warning)/i.test(body)

          if (reflected || (response.status >= 500 && errorLike)) {
            findings.push({
              type: 'Input Validation',
              severity: type === 'sqlInjection' ? 'critical' : 'high',
              title: `Potential ${type} vulnerability`,
              description: `Potential ${type} behavior detected on ${method} ${normalizedPath}`,
              endpoint: normalizedPath,
              method,
              payload: payload.substring(0, 120),
              response: `${response.status}`,
              fix: 'Validate input schema, sanitize/escape output, and enforce server-side checks.'
            })
          }
        } catch {
          // Continue fuzzing remaining payloads/endpoints.
        }
      }
    }

    return findings
  }
}

export default InputScanner
