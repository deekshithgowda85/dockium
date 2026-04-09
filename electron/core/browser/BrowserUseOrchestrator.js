import { chromium, firefox, webkit } from 'playwright'

const REQUEST_TIMEOUT_MS = 6000
const LLM_TIMEOUT_MS = 3500
const MAX_UI_PAGE_TESTS = 60
const MAX_API_ROUTE_TESTS = 70
const MAX_AUTH_ROUTE_TESTS = 20
const MAX_DISCOVERED_UI_LINKS = 120
const MAX_MAPPED_ELEMENTS_PER_PAGE = 240
const MAX_BROKEN_LINK_CHECKS_PER_PAGE = 40
const MAX_BROKEN_LINK_FINDINGS = 80
const UI_CRAWL_TIME_BUDGET_MS = 70000
const MAX_AI_ROUTE_HINT_PAGES = 12
const MAX_AI_ROUTE_HINTS_PER_PAGE = 8
const MAX_AI_ROUTE_HINTS_TOTAL = 80
const MAX_AI_ROUTE_PROMPT_CHARS = 2600
const MAX_AI_ROUTE_HTML_CHARS = 6000
const MAX_AI_AUTH_PROMPT_CHARS = 2200
const MAX_AI_AUTH_TOKENS = 220
const MAX_AI_ROUTE_TOKENS = 140

function normalizeTargetUrl(targetUrl) {
  const raw = String(targetUrl || '').trim()
  if (!raw) {
    return ''
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/$/, '')
  }

  return `http://${raw.replace(/\/$/, '')}`
}

function normalizeMethod(value) {
  return String(value || 'GET').toUpperCase()
}

function routePath(route) {
  return String(route?.path || route?.fullPath || '/').trim() || '/'
}

function routeKey(route) {
  return `${normalizeMethod(route?.method)} ${routePath(route)}`
}

function materializePath(pathValue) {
  return String(pathValue || '/')
    .replace(/:[A-Za-z0-9_]+/g, '1')
    .replace(/\{[A-Za-z0-9_]+\}/g, '1')
    .replace(/\*$/g, '1')
}

function isUiPageRoute(route) {
  const method = normalizeMethod(route?.method)
  if (method !== 'GET' && method !== 'HEAD') {
    return false
  }

  const pathValue = routePath(route).toLowerCase()
  if (pathValue.startsWith('/api/') || pathValue.startsWith('/rest/') || pathValue === '/api' || pathValue === '/rest') {
    return false
  }

  return !/\.(json|xml|js|css|png|jpe?g|gif|svg|ico)$/i.test(pathValue)
}

function isApiRoute(route) {
  const pathValue = routePath(route).toLowerCase()
  return pathValue.startsWith('/api/') || pathValue.startsWith('/rest/') || pathValue === '/api' || pathValue === '/rest'
}

function isAuthRoute(route) {
  const method = normalizeMethod(route?.method)
  if (method !== 'POST') {
    return false
  }
  const pathValue = routePath(route).toLowerCase()
  return /(login|signin|register|signup|auth|session|token)/.test(pathValue)
}

function isProtectedCandidate(route) {
  const method = normalizeMethod(route?.method)
  if (method !== 'GET') {
    return false
  }
  if (route?.authRequired) {
    return true
  }
  const pathValue = routePath(route).toLowerCase()
  return /\/me|\/whoami|\/profile|\/account|\/users\//.test(pathValue)
}

function protectedRouteScore(route) {
  const pathValue = routePath(route).toLowerCase()
  if (/\/me|\/whoami|\/profile|\/account/.test(pathValue)) {
    return 0
  }
  if (/\/users\//.test(pathValue) && !/\/admin/.test(pathValue)) {
    return 1
  }
  if (/\/admin/.test(pathValue)) {
    return 5
  }
  return route?.authRequired ? 2 : 3
}

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions'

function toUrl(baseUrl, pathValue) {
  try {
    return new URL(materializePath(pathValue), `${baseUrl}/`).toString()
  } catch {
    return ''
  }
}

function sameOrigin(urlA, urlB) {
  try {
    return new URL(urlA).origin === new URL(urlB).origin
  } catch {
    return false
  }
}

function toSameOriginPath(baseUrl, candidateUrl) {
  try {
    const parsed = new URL(candidateUrl)
    const base = new URL(baseUrl)
    if (parsed.origin !== base.origin) {
      return ''
    }
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return ''
  }
}

function normalizeDiscoveredUiLink(baseUrl, candidateUrl) {
  const candidate = String(candidateUrl || '').trim()
  if (!candidate) {
    return ''
  }

  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    return ''
  }

  try {
    const base = new URL(baseUrl)
    if (parsed.origin !== base.origin) {
      return ''
    }
  } catch {
    return ''
  }

  const pathname = String(parsed.pathname || '/').toLowerCase()
  if (!pathname || pathname === '/api' || pathname === '/rest' || pathname.startsWith('/api/') || pathname.startsWith('/rest/')) {
    return ''
  }
  if (/\.(json|xml|js|css|png|jpe?g|gif|svg|ico|pdf|zip|map|woff2?|ttf)$/i.test(pathname)) {
    return ''
  }

  const normalized = new URL(parsed.toString())
  normalized.hash = ''
  normalized.search = ''
  return normalized.toString()
}

function normalizeHeaders(headersLike = {}) {
  const out = {}
  for (const [key, value] of Object.entries(headersLike || {})) {
    out[String(key || '').toLowerCase()] = String(value || '')
  }
  return out
}

function sampleFromSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return {}
  }

  const schemaType = String(schema.type || '').toLowerCase()
  if (schemaType === 'array') {
    return [sampleFromSchema(schema.items || { type: 'string' })]
  }

  if (schemaType === 'object' || (schema.properties && typeof schema.properties === 'object')) {
    const out = {}
    for (const [key, nested] of Object.entries(schema.properties || {})) {
      out[key] = sampleFromSchema(nested)
    }
    return out
  }

  if (schemaType === 'boolean') return true
  if (schemaType === 'number' || schemaType === 'integer') return 1
  if (schemaType === 'null') return null
  return 'sample'
}

function buildQueryFromRoute(route) {
  const queryParams = Array.isArray(route?.request?.queryParams) ? route.request.queryParams : []
  if (queryParams.length === 0) {
    return ''
  }

  const search = new URLSearchParams()
  queryParams.forEach((entry, index) => {
    const name = String(entry?.name || `q${index + 1}`).trim()
    if (!name) {
      return
    }
    const rawType = String(entry?.type || '').toLowerCase()
    const value = rawType.includes('number') || rawType.includes('int') ? '1' : 'sample'
    search.append(name, value)
  })

  const built = search.toString()
  return built ? `?${built}` : ''
}

function buildRouteUrl(baseUrl, route) {
  const pathValue = routePath(route)
  const query = buildQueryFromRoute(route)
  return toUrl(baseUrl, `${pathValue}${query}`)
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function clipText(value, maxLength = 420) {
  const text = String(value || '').trim()
  if (!text) {
    return ''
  }
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, Math.max(1, maxLength - 3))}...`
}

function normalizeRouteHintCandidate(baseUrl, candidate) {
  const raw = String(candidate || '').trim()
  if (!raw || raw === '#' || raw.toLowerCase().startsWith('javascript:')) {
    return ''
  }

  try {
    const absolute = new URL(raw, `${baseUrl}/`).toString()
    if (!sameOrigin(baseUrl, absolute)) {
      return ''
    }
    return absolute
  } catch {
    return ''
  }
}

function tokenFromJson(payload) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const candidates = [
    payload.token,
    payload.access_token,
    payload.accessToken,
    payload.jwt,
    payload.id_token,
    payload.idToken,
    payload.authToken,
  ]

  for (const candidate of candidates) {
    const value = String(candidate || '').trim()
    if (value) {
      return value
    }
  }

  for (const nested of [payload.data, payload.result, payload.user, payload.authentication]) {
    const nestedToken = tokenFromJson(nested)
    if (nestedToken) {
      return nestedToken
    }
  }

  return ''
}

function cookieFromResponse(response) {
  try {
    if (typeof response?.headers?.getSetCookie === 'function') {
      const values = response.headers.getSetCookie()
      if (Array.isArray(values) && values.length > 0) {
        return values.map((v) => String(v || '').split(';')[0].trim()).filter(Boolean).join('; ')
      }
    }

    if (typeof response?.headers?.raw === 'function') {
      const raw = response.headers.raw()
      const values = raw?.['set-cookie']
      if (Array.isArray(values) && values.length > 0) {
        return values.map((v) => String(v || '').split(';')[0].trim()).filter(Boolean).join('; ')
      }
    }

    const single = response?.headers?.get?.('set-cookie')
    if (!single) {
      return ''
    }
    return String(single).split(';')[0].trim()
  } catch {
    return ''
  }
}

function authHeaders(token, cookie) {
  const headers = {}
  if (token) {
    headers.Authorization = /^bearer\s+/i.test(token) ? token : `Bearer ${token}`
  }
  if (cookie) {
    headers.Cookie = cookie
  }
  return headers
}

function uniquePayloadVariants(variants = []) {
  const out = []
  const seen = new Set()

  for (const variant of variants) {
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
      continue
    }

    const normalized = {}
    for (const key of Object.keys(variant).sort((a, b) => a.localeCompare(b))) {
      normalized[key] = variant[key]
    }

    const key = JSON.stringify(normalized)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    out.push(variant)
  }

  return out
}

function authPayloadVariants(kind, credential) {
  const email = String(credential?.email || `dockium+${Date.now()}@example.com`)
  const username = String(credential?.username || email.split('@')[0] || 'dockium')
  const password = String(credential?.password || 'Password123!')
  const name = String(credential?.name || 'Dockium BrowserUse')

  if (kind === 'login') {
    return uniquePayloadVariants([
      { email, password },
      { username, password },
      { email: username, password },
      { login: username, password },
      { identifier: email, password },
      { emailOrUsername: email, password },
      { user: { email, password } },
      { credentials: { email, password } },
    ])
  }

  return uniquePayloadVariants([
    {
      email,
      password,
      confirmPassword: password,
      passwordRepeat: password,
      repeatPassword: password,
      confirm: password,
      securityQuestion: {
        id: 1,
      },
      securityQuestionId: 1,
      securityAnswer: 'dockium-generic-answer',
      name,
    },
    {
      email,
      password,
      passwordRepeat: password,
      repeatPassword: password,
      securityQuestion: {
        id: 1,
      },
      securityQuestionId: 1,
      securityAnswer: 'dockium-generic-answer',
      name,
    },
    { username, password, confirmPassword: password, passwordRepeat: password, repeatPassword: password, name },
    { email, username, password, name },
    { login: username, password, confirmPassword: password, passwordRepeat: password, repeatPassword: password, name },
    { email, password, passwordConfirmation: password, name },
  ])
}

function credentialCandidates(config = {}) {
  const credentials = config?.credentials && typeof config.credentials === 'object'
    ? config.credentials
    : {}

  const candidates = []
  const testUserEmail = String(credentials?.testUserEmail || '').trim()
  const testUserPass = String(credentials?.testUserPass || '').trim()
  if (testUserEmail && testUserPass) {
    candidates.push({ email: testUserEmail, password: testUserPass, source: 'test-user' })
  }

  const adminEmail = String(credentials?.adminEmail || '').trim()
  const adminPassword = String(credentials?.adminPassword || '').trim()
  if (adminEmail && adminPassword) {
    candidates.push({ email: adminEmail, password: adminPassword, source: 'admin-user' })
  }

  if (candidates.length === 0) {
    candidates.push({ email: 'user@dockium.local', password: 'Password123!', source: 'fallback' })
    candidates.push({ email: 'test@example.com', password: 'Password123!', source: 'fallback-alt-1' })
    candidates.push({ email: 'admin@example.com', password: 'Password123!', source: 'fallback-alt-2' })
  }

  return candidates
}

function parseAiPayloadCandidates(rawText) {
  const raw = String(rawText || '').trim()
  if (!raw) {
    return []
  }

  const direct = safeJsonParse(raw)
  if (Array.isArray(direct)) {
    return direct.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
  }
  if (direct && typeof direct === 'object') {
    if (Array.isArray(direct.payloads)) {
      return direct.payloads.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    }
    if (direct.payload && typeof direct.payload === 'object' && !Array.isArray(direct.payload)) {
      return [direct.payload]
    }
  }

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (!fencedMatch) {
    return []
  }

  const fencedParsed = safeJsonParse(String(fencedMatch[1] || '').trim())
  if (Array.isArray(fencedParsed)) {
    return fencedParsed.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
  }
  if (fencedParsed && typeof fencedParsed === 'object') {
    if (Array.isArray(fencedParsed.payloads)) {
      return fencedParsed.payloads.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    }
    if (fencedParsed.payload && typeof fencedParsed.payload === 'object' && !Array.isArray(fencedParsed.payload)) {
      return [fencedParsed.payload]
    }
  }

  return []
}

function parseAiRouteCandidates(rawText) {
  const raw = String(rawText || '').trim()
  if (!raw) {
    return []
  }

  const direct = safeJsonParse(raw)
  if (Array.isArray(direct)) {
    return direct
  }
  if (direct && typeof direct === 'object') {
    if (Array.isArray(direct.paths)) {
      return direct.paths
    }
    if (Array.isArray(direct.routes)) {
      return direct.routes
    }
  }

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (!fencedMatch) {
    return []
  }

  const fencedParsed = safeJsonParse(String(fencedMatch[1] || '').trim())
  if (Array.isArray(fencedParsed)) {
    return fencedParsed
  }
  if (fencedParsed && typeof fencedParsed === 'object') {
    if (Array.isArray(fencedParsed.paths)) {
      return fencedParsed.paths
    }
    if (Array.isArray(fencedParsed.routes)) {
      return fencedParsed.routes
    }
  }

  return []
}

function toSimpleSelector(descriptor) {
  const tag = String(descriptor?.tag || 'element').toLowerCase()
  const id = descriptor?.id ? `#${descriptor.id}` : ''
  const className = String(descriptor?.className || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')
  return `${tag}${id}${className ? `.${className}` : ''}`
}

async function captureActionableElements(page, currentUrl) {
  return await page.evaluate((limit) => {
    const nodes = Array.from(document.querySelectorAll('a[href], button, input, textarea, select, form[action], [role="button"], [role="link"], [onclick], [data-testid], [data-test], [aria-label]'))
      .slice(0, limit)

    function readableText(node) {
      const candidate = (node.innerText || node.textContent || node.value || node.getAttribute('aria-label') || '').trim()
      if (!candidate) {
        return '--'
      }
      return candidate.replace(/\s+/g, ' ').slice(0, 160)
    }

    function toAbsolute(value) {
      const raw = String(value || '').trim()
      if (!raw || raw === '#' || raw.toLowerCase().startsWith('javascript:') || raw.toLowerCase().startsWith('mailto:') || raw.toLowerCase().startsWith('tel:')) {
        return ''
      }
      try {
        return new URL(raw, window.location.href).toString()
      } catch {
        return ''
      }
    }

    return nodes.map((node, index) => {
      const tag = String(node.tagName || '').toLowerCase()
      const type = String(node.getAttribute('type') || '').toLowerCase()
      const role = String(node.getAttribute('role') || '').toLowerCase()
      const ariaLabel = String(node.getAttribute('aria-label') || '').trim()
      const name = String(node.getAttribute('name') || '').trim()
      const placeholder = String(node.getAttribute('placeholder') || '').trim()
      const dataTestId = String(node.getAttribute('data-testid') || node.getAttribute('data-test') || '').trim()

      let destination = ''
      if (tag === 'a') {
        destination = toAbsolute(node.getAttribute('href'))
      } else if (tag === 'form') {
        destination = toAbsolute(node.getAttribute('action'))
      } else if ((tag === 'button' || (tag === 'input' && (type === 'button' || type === 'submit'))) && node.form) {
        destination = toAbsolute(node.getAttribute('formaction') || node.form.getAttribute('action') || '')
      }

      if (!destination) {
        const onclick = String(node.getAttribute('onclick') || '')
        const matched = onclick.match(/(?:location(?:\.href)?|window\.open)\s*=\s*['"]([^'"]+)['"]|window\.open\(['"]([^'"]+)['"]\)/i)
        if (matched) {
          destination = toAbsolute(matched[1] || matched[2] || '')
        }
      }

      return {
        index,
        tag,
        type,
        role,
        id: String(node.id || '').trim(),
        className: String(node.className || '').trim(),
        text: readableText(node),
        ariaLabel,
        name,
        placeholder,
        dataTestId,
        destination,
        currentUrl: window.location.href,
      }
    })
  }, MAX_MAPPED_ELEMENTS_PER_PAGE)
}

async function probeLink(request, url, extraHeaders = {}) {
  const candidate = String(url || '').trim()
  if (!candidate) {
    return { checked: false, status: 0, detail: 'no-url' }
  }

  const headers = {
    Accept: 'text/html,application/json;q=0.9,*/*;q=0.5',
    ...(extraHeaders || {}),
  }

  try {
    const headResponse = await request.fetch(candidate, {
      method: 'HEAD',
      timeout: REQUEST_TIMEOUT_MS,
      headers,
    })

    const headStatus = Number(headResponse.status())
    if (headStatus === 405 || headStatus === 501) {
      const fallback = await request.fetch(candidate, {
        method: 'GET',
        timeout: REQUEST_TIMEOUT_MS,
        headers,
      })
      return {
        checked: true,
        status: Number(fallback.status()),
        detail: 'fallback-get',
      }
    }

    return {
      checked: true,
      status: headStatus,
      detail: 'head',
    }
  } catch (error) {
    return {
      checked: true,
      status: 0,
      detail: String(error?.message || 'link-probe-failed'),
    }
  }
}

function dedupeRoutes(routes = []) {
  const seen = new Set()
  const unique = []

  for (const route of routes) {
    const key = routeKey(route)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    unique.push(route)
  }

  return unique
}

function authPayloadFor(route) {
  const pathValue = routePath(route).toLowerCase()
  const seed = `dockium+${Date.now()}@example.com`
  const password = 'Password123!'

  if (/(register|signup)/.test(pathValue)) {
    return {
      email: seed,
      password,
      name: 'Dockium BrowserUse',
    }
  }

  return {
    email: seed,
    password,
  }
}

function findingForStatus(kind, route, url, status, detail = '') {
  if (!status) {
    return {
      type: 'BrowserUse',
      severity: 'medium',
      title: `${kind} probe failed`,
      endpoint: routePath(route),
      description: `${normalizeMethod(route?.method)} ${url} could not be completed. ${detail}`.trim(),
      fix: 'Verify app reachability, upstream dependencies, and route middleware timeouts.',
      proof: `status=0`,
      engine: 'browser-use',
      source: 'browser-use',
    }
  }

  if (status >= 500) {
    return {
      type: 'BrowserUse',
      severity: 'high',
      title: `${kind} route failed with server error`,
      endpoint: routePath(route),
      description: `${normalizeMethod(route?.method)} ${url} returned ${status}. ${detail}`.trim(),
      fix: 'Review route handler and middleware stack; ensure stable status codes and input validation.',
      proof: `status=${status}`,
      engine: 'browser-use',
      source: 'browser-use',
    }
  }

  if (status === 404) {
    return {
      type: 'BrowserUse',
      severity: 'medium',
      title: `${kind} route returned not found`,
      endpoint: routePath(route),
      description: `${normalizeMethod(route?.method)} ${url} returned 404. ${detail}`.trim(),
      fix: 'Validate deployed route prefixes and dynamic route parameter substitutions.',
      proof: `status=${status}`,
      engine: 'browser-use',
      source: 'browser-use',
    }
  }

  if (status >= 400 && status !== 401 && status !== 403) {
    return {
      type: 'BrowserUse',
      severity: 'medium',
      title: `${kind} route returned client error`,
      endpoint: routePath(route),
      description: `${normalizeMethod(route?.method)} ${url} returned ${status}. ${detail}`.trim(),
      fix: 'Validate route contracts, request schema, and required route parameters.',
      proof: `status=${status}`,
      engine: 'browser-use',
      source: 'browser-use',
    }
  }

  return null
}

class BrowserUseOrchestrator {
  constructor(config, fleet) {
    this.config = config
    this.fleet = fleet
  }

  getLauncher() {
    const engine = String(this.config?.modules?.browserEngine || 'chromium').toLowerCase()
    if (engine === 'firefox') return firefox
    if (engine === 'webkit') return webkit
    return chromium
  }

  buildPlan(routes = []) {
    const uniqueRoutes = dedupeRoutes(routes)
    const authRoutes = uniqueRoutes.filter((route) => isAuthRoute(route)).slice(0, MAX_AUTH_ROUTE_TESTS)
    const authKeys = new Set(authRoutes.map((route) => routeKey(route)))

    const uiPages = uniqueRoutes
      .filter((route) => isUiPageRoute(route) && !authKeys.has(routeKey(route)))
      .slice(0, MAX_UI_PAGE_TESTS)
    const uiKeys = new Set(uiPages.map((route) => routeKey(route)))

    const apiRoutes = uniqueRoutes
      .filter((route) => isApiRoute(route) && !authKeys.has(routeKey(route)) && !uiKeys.has(routeKey(route)))
      .slice(0, MAX_API_ROUTE_TESTS)

    return {
      inputCount: routes.length,
      uniqueRoutes,
      uiPages,
      apiRoutes,
      authRoutes,
      duplicatesSkipped: Math.max(0, routes.length - uniqueRoutes.length),
    }
  }

  async runUiPageTests(context, baseUrl, routes = [], authState = {}) {
    const page = await context.newPage()
    const requestHeaders = authHeaders(authState?.token, authState?.cookie)
    if (Object.keys(requestHeaders).length > 0) {
      await page.setExtraHTTPHeaders(requestHeaders)
    }
    const tests = []
    const findings = []
    const pageMappings = []
    const checkedBroken = new Set()
    const brokenLinks = []
    const aiRouteHints = []
    const crawlStartedAt = Date.now()
    let aiHintsAddedTotal = 0
    let crawlTimedOut = false

    const queue = []
    for (const route of routes) {
      const url = buildRouteUrl(baseUrl, route)
      if (!url) {
        continue
      }
      if (!queue.includes(url)) {
        queue.push(url)
      }
    }

    const visited = new Set()

    while (queue.length > 0 && tests.length < MAX_UI_PAGE_TESTS) {
      if (Date.now() - crawlStartedAt > UI_CRAWL_TIME_BUDGET_MS) {
        crawlTimedOut = true
        break
      }

      const url = queue.shift()
      if (!url || visited.has(url)) {
        continue
      }
      visited.add(url)

      const route = routes.find((entry) => buildRouteUrl(baseUrl, entry) === url) || {
        method: 'GET',
        path: toSameOriginPath(baseUrl, url) || '/',
      }

      let status = 0
      let title = ''
      let forms = 0
      let note = ''
      let mappedElements = []
      let discoveredLinks = []

      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS })
        status = Number(response?.status() || 0)
        const responseHeaders = typeof response?.headers === 'function' ? response.headers() : {}
        const contentType = String(responseHeaders?.['content-type'] || '').toLowerCase()
        const htmlLike = contentType.includes('text/html') || contentType === ''

        title = htmlLike ? String(await page.title()) : ''
        forms = htmlLike ? await page.$$eval('form', (entries) => entries.length) : 0
        mappedElements = htmlLike
          ? (await captureActionableElements(page, url)).map((entry) => ({
            ...entry,
            selector: toSimpleSelector(entry),
            destinationPath: toSameOriginPath(baseUrl, entry.destination),
          }))
          : []

        discoveredLinks = mappedElements
          .map((entry) => String(entry.destination || '').trim())
          .filter(Boolean)
          .map((candidate) => normalizeDiscoveredUiLink(baseUrl, candidate))
          .filter(Boolean)

        discoveredLinks = [...new Set(discoveredLinks)]

        for (const discovered of discoveredLinks) {
          if (!visited.has(discovered) && !queue.includes(discovered) && queue.length < MAX_DISCOVERED_UI_LINKS) {
            queue.push(discovered)
          }
        }

        if (tests.length < MAX_AI_ROUTE_HINT_PAGES && aiHintsAddedTotal < MAX_AI_ROUTE_HINTS_TOTAL) {
          let htmlSnippet = ''
          try {
            htmlSnippet = clipText(await page.content(), MAX_AI_ROUTE_HTML_CHARS)
          } catch {
            htmlSnippet = ''
          }

          const hinted = await this.suggestAiUiRouteHints(context, baseUrl, url, mappedElements, htmlSnippet)
          if (hinted.attempted) {
            aiRouteHints.push({
              pageUrl: url,
              status: hinted.status,
              detail: hinted.detail,
              suggested: hinted.routes,
            })
          }

          for (const suggested of hinted.routes || []) {
            if (aiHintsAddedTotal >= MAX_AI_ROUTE_HINTS_TOTAL) {
              break
            }
            if (!visited.has(suggested) && !queue.includes(suggested) && queue.length < MAX_DISCOVERED_UI_LINKS) {
              queue.push(suggested)
              aiHintsAddedTotal += 1
            }
          }
        }

        let checkedCount = 0
        for (const element of mappedElements) {
          const destination = String(element.destination || '').trim()
          if (!destination || !sameOrigin(baseUrl, destination)) {
            continue
          }

          const brokenKey = `${url}|${destination}`
          if (checkedBroken.has(brokenKey)) {
            continue
          }
          if (checkedCount >= MAX_BROKEN_LINK_CHECKS_PER_PAGE) {
            break
          }

          checkedBroken.add(brokenKey)
          checkedCount += 1
          const probe = await probeLink(context.request, destination, requestHeaders)
          const statusCode = Number(probe?.status || 0)

          if (statusCode >= 400 && statusCode !== 401 && statusCode !== 403 && statusCode !== 405) {
            brokenLinks.push({
              from: url,
              to: destination,
              status: statusCode,
              detail: probe.detail,
              element: {
                selector: element.selector,
                text: element.text,
                tag: element.tag,
              },
            })
          }
        }
      } catch (error) {
        note = String(error?.message || 'navigation failed')
      }

      tests.push({
        key: routeKey(route),
        method: normalizeMethod(route?.method),
        path: routePath(route),
        url,
        status,
        title,
        forms,
        elementCount: mappedElements.length,
        brokenLinkCount: brokenLinks.filter((entry) => entry.from === url).length,
        note,
      })

      pageMappings.push({
        key: routeKey(route),
        pageUrl: url,
        status,
        title,
        forms,
        note,
        elementCount: mappedElements.length,
        discoveredLinks: discoveredLinks.slice(0, 100),
        elements: mappedElements,
      })

      const finding = findingForStatus('UI page', route, url, status, note)
      if (finding) {
        findings.push(finding)
      }
    }

    if (crawlTimedOut) {
      findings.push({
        type: 'BrowserUse',
        severity: 'info',
        title: 'UI crawl time budget reached',
        endpoint: baseUrl,
        description: `UI mapping stopped after ${UI_CRAWL_TIME_BUDGET_MS}ms to avoid scanner stall.`,
        fix: 'Increase crawl budget only if needed; review discovered route hints for coverage.',
        proof: `visitedPages=${visited.size} queued=${queue.length}`,
        engine: 'browser-use',
        source: 'browser-use',
      })
    }

    const brokenFindingSeen = new Set()
    for (const broken of brokenLinks.slice(0, MAX_BROKEN_LINK_FINDINGS)) {
      const key = `${broken.from}|${broken.to}|${broken.status}`
      if (brokenFindingSeen.has(key)) {
        continue
      }
      brokenFindingSeen.add(key)

      findings.push({
        type: 'BrowserUse',
        severity: broken.status >= 500 ? 'high' : 'medium',
        title: 'Broken navigation target detected',
        endpoint: toSameOriginPath(baseUrl, broken.to) || broken.to,
        description: `UI element ${broken.element.selector} on ${broken.from} points to ${broken.to}, returning ${broken.status}.`,
        fix: 'Repair stale links/actions or ensure the target route is registered and reachable.',
        proof: `from=${broken.from} to=${broken.to} status=${broken.status}`,
        engine: 'browser-use',
        source: 'browser-use',
      })
    }

    return {
      tests,
      findings,
      mappings: pageMappings,
      brokenLinks,
      visitedPages: visited.size,
      discoveredQueueTotal: queue.length,
      aiRouteHints,
      aiRouteHintsAdded: aiHintsAddedTotal,
      timedOut: crawlTimedOut,
    }
  }

  async runApiRouteTests(context, baseUrl, routes = [], authState = {}) {
    const request = context.request
    const tests = []
    const findings = []
    const inheritedAuthHeaders = authHeaders(authState?.token, authState?.cookie)

    for (const route of routes) {
      const method = normalizeMethod(route?.method)
      const url = buildRouteUrl(baseUrl, route)
      if (!url) {
        continue
      }

      let status = 0
      let note = ''
      let contentType = ''
      let bodyPreview = ''
      const hasBody = ['POST', 'PUT', 'PATCH'].includes(method)
      const payload = hasBody ? sampleFromSchema(route?.request?.bodySchema) : undefined

      try {
        const response = await request.fetch(url, {
          method,
          timeout: REQUEST_TIMEOUT_MS,
          headers: hasBody
            ? {
                ...inheritedAuthHeaders,
                Accept: 'application/json, text/plain;q=0.8, */*;q=0.5',
                'Content-Type': 'application/json',
              }
            : {
                ...inheritedAuthHeaders,
                Accept: 'application/json, text/plain;q=0.8, */*;q=0.5',
              },
          data: hasBody ? JSON.stringify(payload) : undefined,
        })
        status = Number(response.status())
        contentType = String(response.headers()?.['content-type'] || '')
        const text = await response.text()
        bodyPreview = String(text || '').slice(0, 500)
      } catch (error) {
        note = String(error?.message || 'request failed')
      }

      tests.push({
        key: routeKey(route),
        method,
        path: routePath(route),
        url,
        status,
        contentType,
        bodyPreview,
        note,
      })

      const finding = findingForStatus('API', route, url, status, note)
      if (finding) {
        findings.push(finding)
      }
    }

    return { tests, findings }
  }

  async suggestAiUiRouteHints(context, baseUrl, currentUrl, mappedElements = [], htmlSnippet = '') {
    const settings = this.config?.settings || {}
    if (!settings?.reportLlmEnabled) {
      return {
        attempted: false,
        status: 0,
        detail: 'LLM route hints skipped because reportLlmEnabled=false.',
        routes: [],
      }
    }

    const apiKey = String(settings?.reportLlmApiKey || '').trim()
    if (!apiKey) {
      return {
        attempted: false,
        status: 0,
        detail: 'LLM route hints skipped because Groq API key is missing.',
        routes: [],
      }
    }

    const endpoint = String(settings?.reportLlmEndpoint || GROQ_CHAT_COMPLETIONS_URL).trim() || GROQ_CHAT_COMPLETIONS_URL
    const model = String(settings?.reportLlmModel || 'llama-3.1-8b-instant').trim() || 'llama-3.1-8b-instant'
    const elementDigest = mappedElements
      .slice(0, 24)
      .map((entry) => ({
        selector: entry?.selector || '',
        tag: entry?.tag || '',
        text: clipText(entry?.text || '', 80),
        name: clipText(entry?.name || '', 60),
        ariaLabel: clipText(entry?.ariaLabel || '', 60),
        destination: entry?.destinationPath || entry?.destination || '',
      }))

    const prompt = [
      'You help browser route discovery for web security crawling.',
      'Return JSON only. No markdown.',
      `Current page: ${currentUrl}`,
      'Task: infer at most 8 same-origin candidate page paths from HTML and UI elements.',
      'Only include likely navigable pages (exclude assets and APIs).',
      'Output format: {"paths":["/path-1","/path-2"]}',
      `Element digest: ${JSON.stringify(elementDigest)}`,
      `HTML snippet: ${clipText(htmlSnippet, MAX_AI_ROUTE_HTML_CHARS)}`,
    ].join('\n')

    const payload = {
      model,
      messages: [
        { role: 'system', content: 'Return only valid JSON with candidate route paths.' },
        { role: 'user', content: clipText(prompt, MAX_AI_ROUTE_PROMPT_CHARS) },
      ],
      temperature: 0.1,
      max_tokens: MAX_AI_ROUTE_TOKENS,
    }

    try {
      const response = await context.request.post(endpoint, {
        timeout: LLM_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'Dockium-BrowserUse/1.0',
          Authorization: /^bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`,
        },
        data: JSON.stringify(payload),
      })

      const status = Number(response.status() || 0)
      const raw = await response.text()
      const parsed = safeJsonParse(raw)
      const modelText = String(
        parsed?.choices?.[0]?.message?.content
        || parsed?.choices?.[0]?.text
        || parsed?.response
        || parsed?.message?.content
        || parsed?.output
        || raw
      )

      if (status < 200 || status >= 300) {
        return {
          attempted: true,
          status,
          detail: `LLM route hints failed with status ${status}.`,
          routes: [],
        }
      }

      const normalizedRoutes = parseAiRouteCandidates(modelText)
        .map((entry) => normalizeRouteHintCandidate(baseUrl, entry))
        .filter(Boolean)
      const uniqueRoutes = [...new Set(normalizedRoutes)].slice(0, MAX_AI_ROUTE_HINTS_PER_PAGE)

      return {
        attempted: true,
        status,
        detail: uniqueRoutes.length > 0
          ? `LLM suggested ${uniqueRoutes.length} additional route hint(s).`
          : 'LLM returned no usable route hints.',
        routes: uniqueRoutes,
      }
    } catch (error) {
      return {
        attempted: true,
        status: 0,
        detail: String(error?.message || 'LLM route hinting failed'),
        routes: [],
      }
    }
  }

  async suggestAiAuthPayloads(context, route, kind, credential, attemptedStatuses = [], failurePreview = '') {
    const settings = this.config?.settings || {}
    const enabled = settings?.reportLlmEnabled === true
    const endpoint = String(settings?.reportLlmEndpoint || GROQ_CHAT_COMPLETIONS_URL).trim() || GROQ_CHAT_COMPLETIONS_URL
    const model = String(settings?.reportLlmModel || 'llama-3.1-8b-instant').trim() || 'llama-3.1-8b-instant'
    const apiKey = String(settings?.reportLlmApiKey || '').trim()

    if (!enabled) {
      return {
        attempted: false,
        status: 0,
        detail: 'LLM payload suggestion skipped because reportLlmEnabled=false.',
        payloads: [],
      }
    }

    if (!apiKey) {
      return {
        attempted: false,
        status: 0,
        detail: 'LLM payload suggestion skipped because Groq API key is missing in Settings > Scanner (or Report).',
        payloads: [],
      }
    }

    const pathValue = routePath(route)
    const prompt = [
      'You are helping API auth compatibility testing.',
      `Return JSON only. No markdown.`,
      `Task: provide at most 4 candidate ${kind} request payload objects for endpoint path ${pathValue}.`,
      'Each payload must be a flat JSON object except securityQuestion may be nested.',
      'Common fields you may use: email, username, login, identifier, password, confirmPassword, passwordRepeat, name, securityQuestion, securityAnswer.',
      `Credential seed email: ${String(credential?.email || '')}`,
      `Credential seed username: ${String(credential?.username || '')}`,
      `Credential seed password: ${String(credential?.password || '')}`,
      `Recent attempted statuses: ${attemptedStatuses.join(',') || 'none'}`,
      `Recent failure response hint: ${clipText(failurePreview, 160) || 'none'}`,
      'Output format: {"payloads":[{...},{...}]}.',
    ].join('\n')

    const promptBudgeted = clipText(prompt, MAX_AI_AUTH_PROMPT_CHARS)

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Dockium-BrowserUse/1.0',
      Authorization: /^bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`,
    }

    try {
      const response = await context.request.post(endpoint, {
        timeout: LLM_TIMEOUT_MS,
        headers,
        data: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Return only valid JSON payload candidates.' },
            { role: 'user', content: promptBudgeted },
          ],
          temperature: 0.2,
          max_tokens: MAX_AI_AUTH_TOKENS,
        }),
      })

      const status = Number(response.status())
      const raw = await response.text()
      const parsed = safeJsonParse(raw)
      const modelText = String(
        parsed?.choices?.[0]?.message?.content
        || parsed?.choices?.[0]?.text
        || parsed?.response
        || parsed?.message?.content
        || parsed?.output
        || raw
      )

      if (status < 200 || status >= 300) {
        return {
          attempted: true,
          status,
          detail: `LLM payload suggestion failed with status ${status}.`,
          payloads: [],
        }
      }

      const payloads = uniquePayloadVariants(parseAiPayloadCandidates(modelText)).slice(0, 4)
      return {
        attempted: true,
        status,
        detail: payloads.length > 0
          ? `LLM suggested ${payloads.length} auth payload candidate(s).`
          : 'LLM returned no parseable payload candidates.',
        payloads,
      }
    } catch (error) {
      return {
        attempted: true,
        status: 0,
        detail: String(error?.message || 'LLM payload suggestion failed'),
        payloads: [],
      }
    }
  }

  async runAuthRouteTests(context, baseUrl, routes = [], allRoutes = []) {
    const request = context.request
    const tests = []
    const findings = []
    const workflow = {
      register: { attempted: false, ok: false, status: 0, path: '', note: '' },
      login: { attempted: false, ok: false, status: 0, path: '', note: '' },
      protected: { attempted: false, ok: false, status: 0, path: '', note: '' },
      tokenAcquired: false,
      cookieAcquired: false,
      aiPayloadHelp: {
        attempted: false,
        used: false,
        status: 0,
        detail: '',
      },
    }

    const registerRoute = routes.find((route) => /register|signup|create[-_]?account/i.test(routePath(route))) || null
    const loginRoute = routes.find((route) => /login|signin|session|token|auth/i.test(routePath(route))) || null
    const protectedRoute = allRoutes
      .filter((route) => isProtectedCandidate(route))
      .sort((a, b) => protectedRouteScore(a) - protectedRouteScore(b))[0] || null

    const credentialPool = credentialCandidates(this.config || {})
    const baseCredential = {
      email: String(credentialPool[0]?.email || `dockium+${Date.now()}@example.com`),
      username: `dockium_${Date.now()}`,
      password: String(credentialPool[0]?.password || 'Password123!'),
      name: 'Dockium BrowserUse',
    }

    let sessionToken = ''
    let sessionCookie = ''

    const tryVariants = async (route, kind, seed = {}) => {
      if (!route) {
        return { status: 0, ok: false, note: 'route-not-found', payloadKeys: [], token: '', cookie: '' }
      }

      const credential = {
        ...baseCredential,
        ...seed,
        username: String(seed?.username || seed?.email || baseCredential.username || '').split('@')[0] || baseCredential.username,
      }
      const variants = authPayloadVariants(kind, credential)
      let picked = { status: 0, ok: false, note: '', payloadKeys: [], token: '', cookie: '' }
      const seenPayloads = new Set()
      const triedStatuses = []
      let failurePreviewForAi = ''

      const shouldEscalateToAiSoon = () => {
        if (triedStatuses.length < 3) {
          return false
        }

        const recent = triedStatuses.slice(-3).filter((statusCode) => Number(statusCode || 0) > 0)
        if (recent.length < 3) {
          return false
        }

        const repeatedStatus = new Set(recent).size === 1
        const allUnauthorized = recent.every((statusCode) => statusCode === 401 || statusCode === 403)
        const allServerErrors = recent.every((statusCode) => statusCode >= 500)
        return repeatedStatus || allUnauthorized || allServerErrors
      }

      const runCandidatePayload = async (payload, source) => {
        const signature = JSON.stringify(payload)
        if (seenPayloads.has(signature)) {
          return null
        }
        seenPayloads.add(signature)

        let status = 0
        let note = ''
        let token = ''
        let cookie = ''
        let responsePreview = ''
        try {
          const response = await request.post(buildRouteUrl(baseUrl, route), {
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
              Accept: 'application/json, text/plain;q=0.8, */*;q=0.5',
              'Content-Type': 'application/json',
            },
            data: JSON.stringify(payload),
          })
          status = Number(response.status())
          const body = await response.text()
          responsePreview = clipText(body, 160)
          token = tokenFromJson(safeJsonParse(body))
          cookie = cookieFromResponse(response)
        } catch (error) {
          note = String(error?.message || 'auth-route-request-failed')
        }

        triedStatuses.push(status || 0)

        const isRegisterSuccess = kind === 'register' && ((status >= 200 && status < 300) || status === 409)
        const isLoginSuccess = kind === 'login' && status >= 200 && status < 300
        const success = isRegisterSuccess || isLoginSuccess

        const candidate = {
          status,
          ok: success,
          note,
          responsePreview,
          payloadKeys: Object.keys(payload),
          token,
          cookie,
        }

        if (!success && !failurePreviewForAi && responsePreview) {
          failurePreviewForAi = responsePreview
        }

        if (!picked.ok || success || (status > 0 && (picked.status === 0 || status < picked.status))) {
          picked = candidate
        }

        tests.push({
          key: routeKey(route),
          method: 'POST',
          kind,
          path: routePath(route),
          url: buildRouteUrl(baseUrl, route),
          status,
          note,
          responsePreview,
          payloadShape: Object.keys(payload),
          source,
        })

        if (success) {
          return { candidate, success: true }
        }

        return { candidate, success: false }
      }

      for (const payload of variants) {
        const result = await runCandidatePayload(payload, 'heuristic')
        if (!result) {
          continue
        }
        const { candidate, success } = result

        if (!picked.ok || success || (candidate.status > 0 && (picked.status === 0 || candidate.status < picked.status))) {
          picked = candidate
        }

        if (success) {
          return candidate
        }

        if (shouldEscalateToAiSoon()) {
          break
        }
      }

      const aiSuggestion = await this.suggestAiAuthPayloads(
        context,
        route,
        kind,
        credential,
        triedStatuses,
        failurePreviewForAi
      )

      workflow.aiPayloadHelp.attempted = workflow.aiPayloadHelp.attempted || Boolean(aiSuggestion.attempted)
      workflow.aiPayloadHelp.status = Number(aiSuggestion.status || workflow.aiPayloadHelp.status || 0)
      workflow.aiPayloadHelp.detail = aiSuggestion.detail || workflow.aiPayloadHelp.detail

      if (Array.isArray(aiSuggestion.payloads) && aiSuggestion.payloads.length > 0) {
        workflow.aiPayloadHelp.used = true
        for (const payload of aiSuggestion.payloads) {
          const result = await runCandidatePayload(payload, 'ai')
          if (!result) {
            continue
          }

          const { candidate, success } = result
          if (!picked.ok || success || (candidate.status > 0 && (picked.status === 0 || candidate.status < picked.status))) {
            picked = candidate
          }

          if (success) {
            return candidate
          }
        }
      }

      return picked
    }

    if (registerRoute) {
      workflow.register.attempted = true
      workflow.register.path = routePath(registerRoute)
      const registerResult = await tryVariants(registerRoute, 'register', credentialPool[0] || baseCredential)
      workflow.register.ok = registerResult.ok
      workflow.register.status = registerResult.status
      workflow.register.note = registerResult.note
      if (registerResult.status >= 500) {
        findings.push({
          type: 'BrowserUse',
          severity: 'high',
          title: 'Registration flow returned server error',
          endpoint: routePath(registerRoute),
          description: `Registration endpoint returned ${registerResult.status}.`,
          fix: 'Inspect registration controller, DB constraints, and validation middleware handling.',
          proof: `status=${registerResult.status}`,
          engine: 'browser-use',
          source: 'browser-use',
        })
      }
    }

    if (loginRoute) {
      workflow.login.attempted = true
      workflow.login.path = routePath(loginRoute)
      const registerSeed = workflow.register.attempted
        ? {
            email: String(baseCredential.email || '').trim(),
            password: String(baseCredential.password || '').trim(),
            source: 'register-attempt-seed',
          }
        : null
      const loginSeeds = []
      if (registerSeed?.email && registerSeed?.password) {
        loginSeeds.push(registerSeed)
      }
      for (const candidate of credentialPool) {
        const email = String(candidate?.email || '').trim()
        const password = String(candidate?.password || '').trim()
        if (!email || !password) {
          continue
        }
        if (!loginSeeds.some((seed) => seed.email === email && seed.password === password)) {
          loginSeeds.push(candidate)
        }
      }

      let loginResult = null
      for (const seed of loginSeeds) {
        const attempt = await tryVariants(loginRoute, 'login', seed)
        if (!loginResult) {
          loginResult = attempt
        }
        if (attempt.ok) {
          loginResult = attempt
          break
        }
        if ((loginResult.status || 0) === 0 && (attempt.status || 0) > 0) {
          loginResult = attempt
        }
      }

      loginResult = loginResult || { status: 0, ok: false, note: 'no-login-seeds', payloadKeys: [], token: '', cookie: '' }
      workflow.login.ok = loginResult.ok
      workflow.login.status = loginResult.status
      workflow.login.note = loginResult.note
      sessionToken = loginResult.token
      sessionCookie = loginResult.cookie
      workflow.tokenAcquired = Boolean(sessionToken)
      workflow.cookieAcquired = Boolean(sessionCookie)

      if (loginResult.status >= 400 && loginResult.status !== 401 && loginResult.status !== 403) {
        findings.push({
          type: 'BrowserUse',
          severity: loginResult.status >= 500 ? 'high' : 'medium',
          title: 'Login flow returned unexpected error status',
          endpoint: routePath(loginRoute),
          description: `Login endpoint returned ${loginResult.status}.`,
          fix: 'Verify login request schema and auth middleware integration.',
          proof: `status=${loginResult.status}`,
          engine: 'browser-use',
          source: 'browser-use',
        })
      }
    }

    if (protectedRoute && (sessionToken || sessionCookie)) {
      workflow.protected.attempted = true
      workflow.protected.path = routePath(protectedRoute)
      const headers = authHeaders(sessionToken, sessionCookie)
      try {
        const response = await request.fetch(buildRouteUrl(baseUrl, protectedRoute), {
          method: normalizeMethod(protectedRoute?.method),
          timeout: REQUEST_TIMEOUT_MS,
          headers,
        })
        const status = Number(response.status())
        workflow.protected.status = status
        workflow.protected.ok = status >= 200 && status < 400
        if (status === 401 || status === 403) {
          findings.push({
            type: 'BrowserUse',
            severity: 'medium',
            title: 'Authenticated workflow could not access protected route',
            endpoint: routePath(protectedRoute),
            description: `Protected endpoint returned ${status} after login workflow.`,
            fix: 'Validate issued token/cookie scopes and protected-route auth middleware.',
            proof: `status=${status}`,
            engine: 'browser-use',
            source: 'browser-use',
          })
        }
      } catch (error) {
        workflow.protected.ok = false
        workflow.protected.status = 0
        workflow.protected.note = String(error?.message || 'protected-route-check-failed')
      }
    }

    for (const route of routes) {
      const url = buildRouteUrl(baseUrl, route)
      if (!url) {
        continue
      }

      let status = 0
      let note = ''
      const payload = authPayloadFor(route)

      try {
        const response = await request.post(url, {
          timeout: REQUEST_TIMEOUT_MS,
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify(payload),
        })
        status = Number(response.status())
      } catch (error) {
        note = String(error?.message || 'auth route request failed')
      }

      tests.push({
        key: routeKey(route),
        method: 'POST',
        path: routePath(route),
        url,
        status,
        note,
        payloadShape: Object.keys(payload),
      })

      const finding = findingForStatus('Auth', route, url, status, note)
      if (finding) {
        findings.push(finding)
      }
    }

    return {
      tests,
      findings,
      workflow,
      artifact: {
        token: sessionToken,
        cookie: sessionCookie,
      },
    }
  }

  async probeLlmHelpEndpoint(context) {
    const settings = this.config?.settings || {}
    const endpoint = String(settings?.reportLlmEndpoint || GROQ_CHAT_COMPLETIONS_URL).trim() || GROQ_CHAT_COMPLETIONS_URL
    const model = String(settings?.reportLlmModel || 'llama-3.1-8b-instant').trim() || 'llama-3.1-8b-instant'
    const apiKey = String(settings?.reportLlmApiKey || '').trim()

    if (!settings?.reportLlmEnabled) {
      return {
        attempted: false,
        endpoint,
        ok: false,
        status: 0,
        detail: 'LLM probe skipped because reportLlmEnabled=false.',
      }
    }

    if (!apiKey) {
      return {
        attempted: false,
        endpoint,
        ok: false,
        status: 0,
        detail: 'LLM probe skipped because Groq API key is missing in Settings > Scanner (or Report).',
      }
    }

    try {
      const response = await context.request.post(endpoint, {
        timeout: LLM_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          Authorization: /^bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`,
        },
        data: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Reply with OK only.' },
            { role: 'user', content: 'Dockium browser-use health check' },
          ],
          temperature: 0,
          max_tokens: 8,
        }),
      })

      return {
        attempted: true,
        endpoint,
        ok: response.ok(),
        status: Number(response.status()),
        detail: response.ok() ? 'LLM help probe succeeded.' : `LLM help probe failed with status ${response.status()}`,
      }
    } catch (error) {
      return {
        attempted: true,
        endpoint,
        ok: false,
        status: 0,
        detail: String(error?.message || 'LLM help probe failed'),
      }
    }
  }

  async runAll(routes = []) {
    const targetUrl = normalizeTargetUrl(this.config?.project?.targetUrl)
    if (!targetUrl) {
      return {
        findings: [
          {
            type: 'BrowserUse',
            severity: 'high',
            title: 'Browser-use testing skipped: missing target URL',
            endpoint: '--',
            description: 'No project target URL was available for UI/page/route browser testing.',
            fix: 'Configure a valid project target URL and rerun scan.',
            engine: 'browser-use',
            source: 'browser-use',
          },
        ],
        diagnostics: {
          engine: 'browser-use',
          instances: [],
          documentation: null,
        },
      }
    }

    const plan = this.buildPlan(routes)
    const launcher = this.getLauncher()
    const browser = await launcher.launch({ headless: true })

    const findings = []
    const instances = []
    let uiResult = {
      tests: [],
      findings: [],
      mappings: [],
      brokenLinks: [],
      aiRouteHints: [],
      aiRouteHintsAdded: 0,
      timedOut: false,
    }
    let routeResult = {
      tests: [],
      findings: [],
    }
    let llmProbe = {
      attempted: false,
      endpoint: '',
      ok: false,
      status: 0,
      detail: 'No probe attempted.',
    }
    let authArtifact = { token: '', cookie: '' }

    try {
      const authContext = await browser.newContext()
      const authResult = await this.runAuthRouteTests(authContext, targetUrl, plan.authRoutes, plan.uniqueRoutes)
      findings.push(...authResult.findings)
      authArtifact = {
        token: String(authResult?.artifact?.token || '').trim(),
        cookie: String(authResult?.artifact?.cookie || '').trim(),
      }
      llmProbe = await this.probeLlmHelpEndpoint(authContext)
      instances.push({
        instanceId: 'auth-route-runner',
        kind: 'auth-route',
        testedCount: authResult.tests.length,
        tests: authResult.tests,
        workflow: authResult.workflow,
      })
      await authContext.close()

      const uiContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
      uiResult = await this.runUiPageTests(uiContext, targetUrl, plan.uiPages, authArtifact)
      findings.push(...uiResult.findings)
      instances.push({
        instanceId: 'ui-page-runner',
        kind: 'ui-page',
        testedCount: uiResult.tests.length,
        tests: uiResult.tests,
        mappedPages: uiResult.mappings,
        brokenLinks: uiResult.brokenLinks,
        aiRouteHints: uiResult.aiRouteHints,
        timedOut: uiResult.timedOut,
      })
      await uiContext.close()

      const routeContext = await browser.newContext()
      routeResult = await this.runApiRouteTests(routeContext, targetUrl, plan.apiRoutes, authArtifact)
      findings.push(...routeResult.findings)
      instances.push({
        instanceId: 'api-route-runner',
        kind: 'api-route',
        testedCount: routeResult.tests.length,
        tests: routeResult.tests,
      })
      await routeContext.close()
    } finally {
      await browser.close()
    }

    const documentation = {
      generatedAt: new Date().toISOString(),
      orchestrator: 'browser-use',
      targetUrl,
      coverage: {
        inputRoutes: plan.inputCount,
        uniqueRoutes: plan.uniqueRoutes.length,
        duplicatesSkipped: plan.duplicatesSkipped,
        uiPagesTested: instances.find((item) => item.kind === 'ui-page')?.testedCount || 0,
        apiRoutesTested: instances.find((item) => item.kind === 'api-route')?.testedCount || 0,
        authRoutesTested: instances.find((item) => item.kind === 'auth-route')?.testedCount || 0,
        mappedUiElements: (instances.find((item) => item.kind === 'ui-page')?.mappedPages || [])
          .reduce((acc, pageEntry) => acc + Number(pageEntry?.elementCount || 0), 0),
        brokenLinksDetected: (instances.find((item) => item.kind === 'ui-page')?.brokenLinks || []).length,
        aiRouteHintsAdded: Number(uiResult?.aiRouteHintsAdded || 0),
        crawlTimedOut: Boolean(uiResult?.timedOut),
      },
      instances,
      llmHelpProbe: llmProbe,
      authArtifact: {
        token: Boolean(authArtifact?.token),
        cookie: Boolean(authArtifact?.cookie),
      },
    }

    findings.push({
      type: 'BrowserUse',
      severity: 'info',
      title: 'Browser UI/page/route testing documentation generated',
      endpoint: targetUrl,
      description: `Generated browser-use test documentation for ${documentation.coverage.uniqueRoutes} unique routes using isolated browser instances.`,
      proof: JSON.stringify(documentation.coverage),
      fix: 'Review this documentation in report operations and rerun scans after fixes to track progress.',
      engine: 'browser-use',
      source: 'browser-use',
    })

    if (Number(documentation.coverage.brokenLinksDetected || 0) > 0) {
      findings.push({
        type: 'BrowserUse',
        severity: 'medium',
        title: 'Broken links detected during browser traversal',
        endpoint: targetUrl,
        description: `Browser-use detected ${documentation.coverage.brokenLinksDetected} broken navigation targets while mapping UI elements.`,
        proof: `brokenLinks=${documentation.coverage.brokenLinksDetected}`,
        fix: 'Open Scanner > Browser Test Documentation to review mapped pages and repair invalid routes/actions.',
        engine: 'browser-use',
        source: 'browser-use',
      })
    }

    if (llmProbe.attempted && !llmProbe.ok) {
      findings.push({
        type: 'BrowserUse',
        severity: 'medium',
        title: 'LLM help endpoint probe failed',
        endpoint: llmProbe.endpoint || '--',
        description: llmProbe.detail,
        fix: 'Verify Groq API key, endpoint path, and model availability in Settings > Report.',
        proof: `status=${llmProbe.status || 0}`,
        engine: 'browser-use',
        source: 'browser-use',
      })
    }

    return {
      findings,
      diagnostics: {
        engine: 'browser-use',
        instances,
        documentation,
      },
    }
  }
}

export default BrowserUseOrchestrator
