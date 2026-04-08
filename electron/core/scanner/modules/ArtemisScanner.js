const DEFAULT_TIMEOUT_MS = 7000
const MAX_DISCOVERED_ENDPOINTS = 36

const COMMON_ENDPOINTS = [
  '/',
  '/login',
  '/signin',
  '/signup',
  '/register',
  '/admin',
  '/dashboard',
  '/api',
  '/api/login',
  '/api/auth/login',
  '/api/register',
  '/api/users',
  '/api/search',
  '/search',
  '/graphql',
  '/health',
  '/debug',
  '/robots.txt',
]

const SENSITIVE_FILES = [
  '/.env',
  '/.git/config',
  '/.git/HEAD',
  '/config/database.yml',
  '/config/secrets.yml',
  '/backup.zip',
  '/docker-compose.yml',
  '/swagger.json',
]

const DEFAULT_CREDENTIALS = [
  { username: 'admin', password: 'admin' },
  { username: 'admin', password: 'password' },
  { username: 'test', password: 'test123' },
]

function normalizeTargetUrl(targetUrl) {
  const raw = String(targetUrl || '').trim()
  if (!raw) {
    return ''
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw
  }

  return `http://${raw}`
}

function normalizeSeverity(value) {
  const severity = String(value || 'medium').toLowerCase()
  if (['critical', 'high', 'medium', 'low', 'info'].includes(severity)) {
    return severity
  }
  return 'medium'
}

function clipText(value, maxLength = 320) {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return ''
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 3))}...`
}

function normalizeError(error) {
  return String(error?.message || error || 'Request failed')
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))]
}

function extractAllowMethods(headers) {
  const allow = String(headers?.allow || headers?.Allow || '').trim()
  if (!allow) {
    return []
  }
  return allow.split(',').map((entry) => entry.trim().toUpperCase()).filter(Boolean)
}

function toRequestLog(method, url, status, ms) {
  return `${method.toUpperCase()} ${url} -> ${status} (${ms}ms)`
}

function buildFinding(type, severity, title, description, endpoint, proof, fix, payload = 'n/a') {
  return {
    id: `${type.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    type,
    severity: normalizeSeverity(severity),
    title,
    description,
    endpoint,
    payload,
    response: endpoint,
    proof: clipText(proof, 500),
    fix,
    request: payload,
  }
}

async function timedFetch(url, options = {}) {
  const controller = new AbortController()
  const timeoutMs = Math.max(250, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS))
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      redirect: 'manual',
      signal: controller.signal,
    })

    const text = await response.text()
    return {
      ok: true,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      text,
      ms: Date.now() - started,
      url,
      method: options.method || 'GET',
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      headers: {},
      text: '',
      ms: Date.now() - started,
      url,
      method: options.method || 'GET',
      error: normalizeError(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

function buildUrl(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString()
  } catch {
    return ''
  }
}

function isSameOrigin(baseUrl, candidateUrl) {
  try {
    const base = new URL(baseUrl)
    const candidate = new URL(candidateUrl)
    return base.origin === candidate.origin
  } catch {
    return false
  }
}

function extractLinksFromHtml(baseUrl, html) {
  const text = String(html || '')
  const hrefMatches = [...text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
  const actionMatches = [...text.matchAll(/action\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
  const candidates = [...hrefMatches, ...actionMatches]
    .map((entry) => buildUrl(baseUrl, entry))
    .filter((entry) => isSameOrigin(baseUrl, entry))

  return unique(candidates).slice(0, MAX_DISCOVERED_ENDPOINTS)
}

function findLikelyEndpoints(urls = [], pattern) {
  return urls.filter((url) => pattern.test(url.toLowerCase()))
}

function hasSecurityHeaders(headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key || '').toLowerCase(), String(value || '')])
  )

  const required = [
    'content-security-policy',
    'x-frame-options',
    'x-content-type-options',
    'strict-transport-security',
  ]

  return required.filter((header) => !normalized[header])
}

function xssProbeText() {
  return '<svg onload=alert("dockium")>'
}

function sqliProbeText() {
  return "' OR '1'='1"
}

function nosqlProbePayload() {
  return JSON.stringify({
    username: { $ne: null },
    password: { $ne: null },
  })
}

function commandInjectionProbe() {
  return '127.0.0.1;id'
}

function templateInjectionProbe() {
  return '{{7*7}}'
}

class ArtemisScanner {
  constructor(config) {
    this.config = config
  }

  buildTargetCandidates(targetUrl) {
    const normalized = normalizeTargetUrl(targetUrl)
    if (!normalized) {
      return []
    }

    const candidates = []
    try {
      const parsed = new URL(normalized)
      const host = parsed.hostname.toLowerCase()
      if (host === 'localhost' || host === '127.0.0.1') {
        const hostInternal = new URL(parsed.toString())
        hostInternal.hostname = 'host.docker.internal'
        candidates.push(hostInternal.toString())

        const appContainer = new URL(parsed.toString())
        appContainer.hostname = 'dockium-app'
        candidates.push(appContainer.toString())
      }
      candidates.push(parsed.toString())
    } catch {
      candidates.push(normalized)
    }

    return unique(candidates)
  }

  async discoverEndpoints(baseUrl, onLog) {
    const seed = COMMON_ENDPOINTS.map((path) => buildUrl(baseUrl, path)).filter(Boolean)
    const root = await timedFetch(baseUrl, { method: 'GET', timeoutMs: 6000 })

    if (root.ok) {
      onLog?.(toRequestLog('GET', baseUrl, root.status, root.ms))
    }

    const htmlLinks = root.ok ? extractLinksFromHtml(baseUrl, root.text) : []
    return unique([...seed, ...htmlLinks]).slice(0, MAX_DISCOVERED_ENDPOINTS)
  }

  async runSecurityHeadersTest(baseUrl) {
    const response = await timedFetch(baseUrl, { method: 'GET' })
    if (!response.ok) {
      return []
    }

    const missing = hasSecurityHeaders(response.headers)
    if (missing.length === 0) {
      return []
    }

    return [
      buildFinding(
        'Artemis',
        'medium',
        'Missing defensive security headers',
        `Response is missing: ${missing.join(', ')}`,
        baseUrl,
        JSON.stringify(response.headers, null, 2),
        'Set the missing headers in gateway or app middleware to reduce browser attack surface.',
        'GET /'
      ),
    ]
  }

  async runCorsMisconfigTest(baseUrl) {
    const response = await timedFetch(baseUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://attacker.example',
        'Access-Control-Request-Method': 'POST',
      },
    })

    if (!response.ok) {
      return []
    }

    const allowOrigin = String(response.headers['access-control-allow-origin'] || '')
    const allowCredentials = String(response.headers['access-control-allow-credentials'] || '')
    if (allowOrigin !== '*' || allowCredentials.toLowerCase() !== 'true') {
      return []
    }

    return [
      buildFinding(
        'Artemis',
        'high',
        'CORS allows wildcard origin with credentials',
        'Cross-origin credentials with wildcard origin can expose session-bound APIs to untrusted origins.',
        baseUrl,
        `allow-origin=${allowOrigin}, allow-credentials=${allowCredentials}`,
        'Restrict allow-origin to trusted domains and disable credentialed CORS for public endpoints.',
        'OPTIONS /'
      ),
    ]
  }

  async runMethodTamperingTest(endpoints = []) {
    const targets = endpoints.slice(0, 8)
    const findings = []

    for (const endpoint of targets) {
      const response = await timedFetch(endpoint, { method: 'OPTIONS', timeoutMs: 4000 })
      if (!response.ok) {
        continue
      }
      const methods = extractAllowMethods(response.headers)
      if (!methods.includes('PUT') && !methods.includes('DELETE') && !methods.includes('TRACE')) {
        continue
      }

      findings.push(
        buildFinding(
          'Artemis',
          'low',
          'Potentially risky HTTP methods exposed',
          'Endpoint advertises sensitive methods via Allow header.',
          endpoint,
          `Allow: ${methods.join(', ')}`,
          'Limit methods to required verbs only and disable TRACE.',
          'OPTIONS endpoint'
        )
      )
    }

    return findings
  }

  async runDefaultCredentialsTest(endpoints = []) {
    const loginTargets = findLikelyEndpoints(endpoints, /(login|signin|auth)/)
    if (loginTargets.length === 0) {
      return []
    }

    const findings = []
    for (const target of loginTargets.slice(0, 3)) {
      for (const cred of DEFAULT_CREDENTIALS) {
        const response = await timedFetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cred.username, password: cred.password }),
        })

        if (!response.ok) {
          continue
        }

        const likelySuccess = response.status >= 200
          && response.status < 400
          && !/invalid|unauthorized|incorrect|failed/i.test(response.text)

        if (!likelySuccess) {
          continue
        }

        findings.push(
          buildFinding(
            'Artemis',
            'critical',
            'Default credentials may allow authentication',
            `Login endpoint appears to accept default credentials for ${cred.username}.`,
            target,
            `status=${response.status}`,
            'Disable default accounts and enforce credential rotation.',
            JSON.stringify(cred)
          )
        )
        break
      }
    }

    return findings
  }

  async runRateLimitTest(endpoints = []) {
    const loginTargets = findLikelyEndpoints(endpoints, /(login|signin|auth)/)
    if (loginTargets.length === 0) {
      return []
    }

    const target = loginTargets[0]
    const statuses = []

    for (let i = 0; i < 6; i += 1) {
      const response = await timedFetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'dockium-rate-limit-test', password: `bad-${Date.now()}-${i}` }),
      })
      statuses.push(response.status)
    }

    if (statuses.includes(429)) {
      return []
    }

    return [
      buildFinding(
        'Artemis',
        'medium',
        'No visible login rate limiting',
        'Repeated invalid authentication requests did not trigger HTTP 429.',
        target,
        `statuses=${statuses.join(',')}`,
        'Add IP/user-based throttling and backoff for authentication endpoints.',
        '6 repeated invalid login attempts'
      ),
    ]
  }

  async runErrorDisclosureTest(baseUrl) {
    const probe = buildUrl(baseUrl, `/__dockium_probe__/${Date.now()}?debug=true`)
    const response = await timedFetch(probe, { method: 'GET' })
    if (!response.ok) {
      return []
    }

    const disclosures = /(exception|traceback|stack\s*trace|sqlstate|syntax error)/i.test(response.text)
    if (!disclosures) {
      return []
    }

    return [
      buildFinding(
        'Artemis',
        'high',
        'Detailed error disclosure detected',
        'Error response appears to leak stack traces or backend exception details.',
        probe,
        clipText(response.text, 500),
        'Disable debug error pages and return sanitized production error responses.',
        'GET invalid probe route'
      ),
    ]
  }

  async runSqlInjectionHeuristicTest(endpoints = []) {
    const targets = findLikelyEndpoints(endpoints, /(search|query|filter|users|items|products)/)
    if (targets.length === 0) {
      return []
    }

    const findings = []
    for (const target of targets.slice(0, 4)) {
      const baseline = await timedFetch(`${target}${target.includes('?') ? '&' : '?'}q=normal`, { method: 'GET' })
      const probe = await timedFetch(`${target}${target.includes('?') ? '&' : '?'}q=${encodeURIComponent(sqliProbeText())}`, { method: 'GET' })

      if (!baseline.ok || !probe.ok) {
        continue
      }

      const hints = /(sql|syntax|database|sqlite|postgres|mysql|odbc)/i.test(probe.text)
      const shapeDelta = Math.abs((baseline.text || '').length - (probe.text || '').length)
      if (!hints && shapeDelta < 120) {
        continue
      }

      findings.push(
        buildFinding(
          'Artemis',
          hints ? 'high' : 'medium',
          'Possible SQL injection behavior',
          'Response to SQL-like payload changed significantly or exposed DB error clues.',
          target,
          `baseline=${baseline.status}/${baseline.text.length}, probe=${probe.status}/${probe.text.length}`,
          'Enforce parameterized queries and strict server-side input validation.',
          `q=${sqliProbeText()}`
        )
      )
    }

    return findings
  }

  async runReflectedXssTest(endpoints = []) {
    const targets = findLikelyEndpoints(endpoints, /(search|query|filter|echo|debug)/)
    if (targets.length === 0) {
      return []
    }

    const probe = xssProbeText()
    const findings = []

    for (const target of targets.slice(0, 4)) {
      const url = `${target}${target.includes('?') ? '&' : '?'}q=${encodeURIComponent(probe)}`
      const response = await timedFetch(url, { method: 'GET' })

      if (!response.ok || !response.text.includes(probe)) {
        continue
      }

      findings.push(
        buildFinding(
          'Artemis',
          'high',
          'Potential reflected XSS',
          'Attacker-controlled payload appears in response without encoding.',
          target,
          `payload reflected in response body (status ${response.status})`,
          'HTML-encode untrusted input and apply strict output encoding policies.',
          `q=${probe}`
        )
      )
    }

    return findings
  }

  async runPathTraversalTest(endpoints = []) {
    const targets = findLikelyEndpoints(endpoints, /(download|file|export|logs|report)/)
    if (targets.length === 0) {
      return []
    }

    const findings = []
    const probes = [
      '../../../../../etc/passwd',
      '..\\..\\..\\..\\windows\\win.ini',
    ]

    for (const target of targets.slice(0, 4)) {
      for (const pathProbe of probes) {
        const url = `${target}${target.includes('?') ? '&' : '?'}path=${encodeURIComponent(pathProbe)}`
        const response = await timedFetch(url, { method: 'GET' })

        if (!response.ok) {
          continue
        }

        const leaked = /(root:x:|\[extensions\]|\[fonts\])/i.test(response.text)
        if (!leaked) {
          continue
        }

        findings.push(
          buildFinding(
            'Artemis',
            'critical',
            'Path traversal file disclosure',
            'Traversal payload appears to expose host file content.',
            target,
            clipText(response.text, 280),
            'Canonicalize and validate file paths; enforce strict allowlists.',
            `path=${pathProbe}`
          )
        )
      }
    }

    return findings
  }

  async runSensitiveFileExposureTest(baseUrl) {
    const findings = []

    for (const filePath of SENSITIVE_FILES) {
      const url = buildUrl(baseUrl, filePath)
      const response = await timedFetch(url, { method: 'GET', timeoutMs: 3500 })
      if (!response.ok || response.status >= 400) {
        continue
      }

      const suspicious = /(DATABASE_URL|SECRET_KEY|\[core\]|postgres|mysql|redis|api[_-]?key)/i.test(response.text)
      if (!suspicious) {
        continue
      }

      findings.push(
        buildFinding(
          'Artemis',
          'critical',
          'Sensitive file exposure',
          'Potential secrets/configuration file is publicly accessible.',
          url,
          clipText(response.text, 280),
          'Block direct access to private files and rotate any exposed credentials.',
          `GET ${filePath}`
        )
      )
    }

    return findings
  }

  async runWeakAuthzTest(endpoints = []) {
    const targets = findLikelyEndpoints(endpoints, /(admin|internal|manage|config|users)/)
    if (targets.length === 0) {
      return []
    }

    const findings = []
    for (const target of targets.slice(0, 5)) {
      const response = await timedFetch(target, {
        method: 'GET',
        headers: { Authorization: 'Bearer invalid-token' },
      })

      if (!response.ok) {
        continue
      }

      if ([401, 403].includes(response.status)) {
        continue
      }

      findings.push(
        buildFinding(
          'Artemis',
          'high',
          'Protected endpoint may be reachable without valid auth',
          'Endpoint returned non-authz error/success despite invalid token.',
          target,
          `status=${response.status}`,
          'Enforce auth checks before route handler execution and verify token claims.',
          'Authorization: Bearer invalid-token'
        )
      )
    }

    return findings
  }

  async runNoSqlInjectionHeuristicTest(endpoints = []) {
    const targets = findLikelyEndpoints(endpoints, /(login|signin|auth|search|filter|query)/)
    if (targets.length === 0) {
      return []
    }

    const findings = []
    for (const target of targets.slice(0, 4)) {
      const response = await timedFetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: nosqlProbePayload(),
      })

      if (!response.ok) {
        continue
      }

      const suspicious = response.status < 400 && !/invalid|unauthorized|failed|error/i.test(response.text)
      if (!suspicious) {
        continue
      }

      findings.push(
        buildFinding(
          'Artemis',
          'high',
          'Possible NoSQL injection behavior',
          'NoSQL operator payload did not trigger expected auth/query rejection.',
          target,
          `status=${response.status}`,
          'Reject operator-style objects and enforce strict schema validation on JSON input.',
          nosqlProbePayload()
        )
      )
    }

    return findings
  }

  async runCommandInjectionHeuristicTest(endpoints = []) {
    const targets = findLikelyEndpoints(endpoints, /(ping|dns|host|cmd|exec|shell|trace)/)
    if (targets.length === 0) {
      return []
    }

    const findings = []
    for (const target of targets.slice(0, 4)) {
      const url = `${target}${target.includes('?') ? '&' : '?'}host=${encodeURIComponent(commandInjectionProbe())}`
      const response = await timedFetch(url, { method: 'GET' })
      if (!response.ok) {
        continue
      }

      const suspicious = /(uid=|gid=|command not found|sh:|bash:|bin\/sh)/i.test(response.text)
      if (!suspicious) {
        continue
      }

      findings.push(
        buildFinding(
          'Artemis',
          'critical',
          'Possible command injection behavior',
          'Command-like payload appears to influence backend execution output.',
          target,
          clipText(response.text, 320),
          'Avoid shell execution with user input; enforce allowlists and parameterized process execution.',
          `host=${commandInjectionProbe()}`
        )
      )
    }

    return findings
  }

  async runTemplateInjectionHeuristicTest(endpoints = []) {
    const targets = findLikelyEndpoints(endpoints, /(render|template|preview|message|email|name)/)
    if (targets.length === 0) {
      return []
    }

    const probe = templateInjectionProbe()
    const findings = []
    for (const target of targets.slice(0, 4)) {
      const url = `${target}${target.includes('?') ? '&' : '?'}name=${encodeURIComponent(probe)}`
      const response = await timedFetch(url, { method: 'GET' })
      if (!response.ok) {
        continue
      }

      const evaluated = /\b49\b/.test(response.text) && !response.text.includes(probe)
      if (!evaluated) {
        continue
      }

      findings.push(
        buildFinding(
          'Artemis',
          'high',
          'Possible server-side template injection',
          'Template payload appears to be evaluated on the server response path.',
          target,
          `response contains computed value for ${probe}`,
          'Escape template input and disable dynamic template evaluation from user input.',
          `name=${probe}`
        )
      )
    }

    return findings
  }

  async runOpenRedirectTest(endpoints = []) {
    const targets = findLikelyEndpoints(endpoints, /(redirect|return|next|url|callback)/)
    if (targets.length === 0) {
      return []
    }

    const findings = []
    for (const target of targets.slice(0, 4)) {
      const url = `${target}${target.includes('?') ? '&' : '?'}next=${encodeURIComponent('https://attacker.example')}`
      const response = await timedFetch(url, { method: 'GET' })
      if (!response.ok) {
        continue
      }

      const location = String(response.headers?.location || '')
      if (![301, 302, 303, 307, 308].includes(response.status) || !/attacker\.example/i.test(location)) {
        continue
      }

      findings.push(
        buildFinding(
          'Artemis',
          'medium',
          'Potential open redirect',
          'User-controlled redirect parameter may send users to external domains.',
          target,
          `location=${location}`,
          'Allow only trusted relative redirect targets and validate redirect parameters.',
          'next=https://attacker.example'
        )
      )
    }

    return findings
  }

  async scanCandidate(candidateUrl, options = {}) {
    const onLog = options.onLog
    const onProgress = options.onProgress

    const heartbeat = await timedFetch(candidateUrl, { method: 'GET', timeoutMs: 5000 })
    if (!heartbeat.ok) {
      throw new Error(`Target not reachable: ${candidateUrl} | ${heartbeat.error}`)
    }

    onLog?.(`Artemis connected to ${candidateUrl}`)
    onProgress?.({ phaseName: 'discovering', percent: 20, candidateUrl })

    const endpoints = await this.discoverEndpoints(candidateUrl, onLog)
    const plan = [
      { name: 'headers', fn: () => this.runSecurityHeadersTest(candidateUrl) },
      { name: 'cors', fn: () => this.runCorsMisconfigTest(candidateUrl) },
      { name: 'methods', fn: () => this.runMethodTamperingTest(endpoints) },
      { name: 'defaults', fn: () => this.runDefaultCredentialsTest(endpoints) },
      { name: 'ratelimit', fn: () => this.runRateLimitTest(endpoints) },
      { name: 'errors', fn: () => this.runErrorDisclosureTest(candidateUrl) },
      { name: 'sqli', fn: () => this.runSqlInjectionHeuristicTest(endpoints) },
      { name: 'nosqli', fn: () => this.runNoSqlInjectionHeuristicTest(endpoints) },
      { name: 'cmdi', fn: () => this.runCommandInjectionHeuristicTest(endpoints) },
      { name: 'templatei', fn: () => this.runTemplateInjectionHeuristicTest(endpoints) },
      { name: 'xss', fn: () => this.runReflectedXssTest(endpoints) },
      { name: 'traversal', fn: () => this.runPathTraversalTest(endpoints) },
      { name: 'open-redirect', fn: () => this.runOpenRedirectTest(endpoints) },
      { name: 'sensitive-files', fn: () => this.runSensitiveFileExposureTest(candidateUrl) },
      { name: 'authz', fn: () => this.runWeakAuthzTest(endpoints) },
    ]

    const findings = []
    const testRuns = []

    for (let index = 0; index < plan.length; index += 1) {
      const test = plan[index]
      const percent = Math.min(95, 25 + Math.floor(((index + 1) / plan.length) * 65))
      onProgress?.({ phaseName: `artemis-${test.name}`, percent, candidateUrl })

      try {
        const started = Date.now()
        const testFindings = await test.fn()
        findings.push(...testFindings)
        testRuns.push({
          name: test.name,
          findingCount: testFindings.length,
          durationMs: Date.now() - started,
          status: 'ok',
        })
      } catch (error) {
        const message = normalizeError(error)
        onLog?.(`Artemis test ${test.name} failed: ${message}`, 'warn')
        testRuns.push({
          name: test.name,
          findingCount: 0,
          durationMs: 0,
          status: 'failed',
          error: message,
        })
      }
    }

    findings.push(
      buildFinding(
        'Artemis',
        'info',
        'Artemis scan diagnostics',
        `Artemis ran ${plan.length} attacker checks across ${endpoints.length} endpoints.`,
        candidateUrl,
        JSON.stringify({ tests: testRuns.length, endpoints: endpoints.length }, null, 2),
        'Use diagnostics to prioritize endpoint hardening and rerun after fixes.',
        'artemis-diagnostics'
      )
    )

    return {
      targetUrl: candidateUrl,
      findings,
      diagnostics: {
        engine: 'artemis',
        testsRun: testRuns,
        endpointCount: endpoints.length,
      },
    }
  }

  async scan(targetUrl, options = {}) {
    const onLog = options.onLog
    const onProgress = options.onProgress
    const candidates = this.buildTargetCandidates(targetUrl)

    if (candidates.length === 0) {
      throw new Error('Missing valid target URL for Artemis active scan')
    }

    const candidateAttempts = []
    let lastError = null

    onLog?.('Running Artemis active attacker scanner (11 checks)')

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]
      onProgress?.({ phaseName: 'candidate-probe', percent: 10 + index * 10, candidateUrl: candidate })

      try {
        const result = await this.scanCandidate(candidate, options)
        candidateAttempts.push({
          candidateUrl: candidate,
          status: 'success',
          findingCount: Array.isArray(result?.findings) ? result.findings.length : 0,
          commands: result?.diagnostics?.testsRun || [],
        })

        return {
          targetUrl: result.targetUrl,
          findings: result.findings,
          diagnostics: {
            templateSetup: {
              ready: true,
              source: 'artemis-engine',
              warnings: [],
            },
            candidates: candidateAttempts,
            engine: 'artemis',
            testsRun: result?.diagnostics?.testsRun || [],
            endpointCount: result?.diagnostics?.endpointCount || 0,
          },
        }
      } catch (error) {
        const message = normalizeError(error)
        lastError = error
        candidateAttempts.push({
          candidateUrl: candidate,
          status: 'failed',
          findingCount: 0,
          error: message,
          commands: [],
        })
        onLog?.(`Artemis candidate failed (${candidate}): ${message}`, 'warn')
      }
    }

    const error = lastError || new Error('Artemis scan failed for all target candidates')
    error.candidateAttempts = candidateAttempts
    error.templateSetup = {
      ready: false,
      source: 'artemis-engine',
      warnings: [normalizeError(lastError || 'all candidates failed')],
    }
    throw error
  }
}

export default ArtemisScanner
