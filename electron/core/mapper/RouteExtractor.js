import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.py'])
const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.venv', 'venv'])

function runtimeBase(repoPath) {
  if (!repoPath) {
    return process.cwd()
  }
  return path.isAbsolute(repoPath) ? repoPath : path.resolve(process.cwd(), repoPath)
}

function toPosix(value) {
  return String(value || '').split(path.sep).join('/')
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function cleanPath(value) {
  const raw = String(value || '/').trim()
  if (!raw || raw === '/') {
    return '/'
  }
  return `/${raw.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

function normalizePathPattern(value) {
  const clean = cleanPath(value)
  return clean
    .replace(/<([a-zA-Z_][a-zA-Z0-9_]*:)?([a-zA-Z_][a-zA-Z0-9_]*)>/g, ':$2')
    .replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, ':$1')
    .replace(/\/+/g, '/')
}

function pathParamsFromPattern(pattern) {
  return Array.from(String(pattern || '').matchAll(/:([A-Za-z0-9_]+)/g)).map((match) => ({
    name: match[1],
    type: 'string',
    required: true,
  }))
}

function stringifyError(error, fallback = 'Unexpected error') {
  const message = String(error?.message || fallback)
  return message.length > 400 ? `${message.slice(0, 397)}...` : message
}

function inferPrimitiveType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function inferSchema(value, depth = 0) {
  if (depth > 4) {
    return { type: inferPrimitiveType(value) }
  }

  const type = inferPrimitiveType(value)
  if (type === 'array') {
    const first = value.find((item) => item !== undefined)
    return {
      type: 'array',
      items: first === undefined ? { type: 'unknown' } : inferSchema(first, depth + 1),
    }
  }

  if (type !== 'object' || value === null) {
    return { type }
  }

  const properties = {}
  for (const [key, entry] of Object.entries(value)) {
    properties[key] = inferSchema(entry, depth + 1)
  }

  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
  }
}

function decodeBody(text) {
  const raw = String(text || '').trim()
  if (!raw) {
    return { raw: '', json: null }
  }
  try {
    return { raw, json: JSON.parse(raw) }
  } catch {
    return { raw, json: null }
  }
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error }
  }
}

function mergeUnique(base = [], incoming = []) {
  return [...new Set([...asArray(base), ...asArray(incoming)].filter(Boolean))]
}

function routeKey(method, fullPath) {
  return `${String(method || 'GET').toUpperCase()} ${normalizePathPattern(fullPath || '/')}`
}

function authTagForRoute(route) {
  if (route.authFailed) return 'AUTH FAILED'
  if (route.authLive) return 'AUTHED + LIVE DATA'
  if (route.authRequired) return 'AUTH REQUIRED'
  return 'PUBLIC'
}

async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8')
  return JSON.parse(content)
}

async function walkFiles(basePath, out = [], relativePrefix = '') {
  const entries = await fs.readdir(basePath, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) {
      continue
    }

    const abs = path.join(basePath, entry.name)
    const rel = toPosix(path.join(relativePrefix, entry.name))
    if (entry.isDirectory()) {
      await walkFiles(abs, out, rel)
      continue
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push({ abs, rel })
    }
  }
  return out
}

function parseOpenApiJson(spec) {
  if (!spec || typeof spec !== 'object') {
    return { routes: [], title: '', version: '' }
  }

  const title = String(spec?.info?.title || '')
  const version = String(spec?.info?.version || '')
  const routes = []

  for (const [rawPath, operations] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(operations || {})) {
      const normalizedMethod = String(method || '').toUpperCase()
      if (!METHOD_ORDER.includes(normalizedMethod)) {
        continue
      }

      routes.push({
        method: normalizedMethod,
        path: normalizePathPattern(rawPath),
        requestBodySchema: operation?.requestBody?.content?.['application/json']?.schema || null,
        responses: operation?.responses || {},
        permissions: mergeUnique(operation?.security?.map((item) => Object.keys(item || {})).flat(), []),
        summary: String(operation?.summary || ''),
        operationId: String(operation?.operationId || ''),
        tags: asArray(operation?.tags),
      })
    }
  }

  return { routes, title, version }
}

function buildTokenHeaders(tokenInput = '') {
  const token = String(tokenInput || '').trim()
  if (!token) {
    return {}
  }

  if (/^bearer\s+/i.test(token)) {
    return { Authorization: token }
  }

  if (token.includes('=') && token.includes(';')) {
    return { Cookie: token }
  }

  if (token.includes('=') && !token.includes(' ')) {
    const [key, ...rest] = token.split('=')
    return { [key.trim()]: rest.join('=').trim() }
  }

  return { Authorization: `Bearer ${token}` }
}

function extractTokenFromPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const directCandidates = [
    payload.token,
    payload.access_token,
    payload.accessToken,
    payload.jwt,
    payload.id_token,
    payload.idToken,
    payload.authToken,
  ]

  for (const candidate of directCandidates) {
    const value = String(candidate || '').trim()
    if (value) {
      return value
    }
  }

  const nestedCandidates = [payload.data, payload.result, payload.user, payload.authentication]
  for (const nested of nestedCandidates) {
    const token = extractTokenFromPayload(nested)
    if (token) {
      return token
    }
  }

  return ''
}

function getSetCookieValues(response) {
  try {
    if (typeof response?.headers?.getSetCookie === 'function') {
      const values = response.headers.getSetCookie()
      return Array.isArray(values) ? values : []
    }

    if (typeof response?.headers?.raw === 'function') {
      const raw = response.headers.raw()
      const values = raw?.['set-cookie']
      return Array.isArray(values) ? values : []
    }

    const single = response?.headers?.get?.('set-cookie')
    return single ? [single] : []
  } catch {
    return []
  }
}

function toCookieHeader(cookies = []) {
  return cookies
    .map((cookie) => String(cookie || '').split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

function substitutePathParams(routePath, params = []) {
  let result = normalizePathPattern(routePath)
  asArray(params).forEach((param, index) => {
    const sample = param?.sample || (index + 1).toString()
    result = result.replace(`:${param?.name}`, encodeURIComponent(sample))
  })
  return result
}

function buildQueryString(params = []) {
  const search = new URLSearchParams()
  asArray(params).forEach((param, index) => {
    const name = String(param?.name || `q${index + 1}`).trim()
    if (!name) {
      return
    }

    const value = String(
      param?.value
      ?? param?.sample
      ?? (String(param?.type || '').toLowerCase().includes('number') ? 1 : 'sample')
    )
    search.append(name, value)
  })

  const serialized = search.toString()
  return serialized ? `?${serialized}` : ''
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      shell: false,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() })
    })

    child.on('close', (code) => {
      resolve({ code: Number(code || 0), stdout, stderr })
    })
  })
}

class RouteExtractor {
  constructor() {
    this.lastAuthInfo = {
      mode: 'none',
      source: 'none',
      success: false,
      endpoint: '',
      message: 'No authentication token provided.',
    }
  }

  async extract(repoPath, frameworkInfo) {
    const detailed = await this.extractDetailed(repoPath, frameworkInfo)
    return detailed.routes.map((route) => ({
      method: route.method,
      path: route.path,
      authRequired: route.authRequired,
      sourceFile: route.sourceFile,
      sourceLine: route.sourceLine,
      params: route.request?.pathParams?.map((param) => param.name) || [],
      queryParams: route.request?.queryParams?.map((param) => param.name) || [],
      inferred: false,
      requestShape: JSON.stringify(route.request?.bodySchema || {}, null, 2),
      responseShape: JSON.stringify(route.response?.bodySchema || {}, null, 2),
      middlewareChain: route.middlewareChain,
      handlerName: route.handlerName,
      authStatus: route.authStatus,
    }))
  }

  getLastAuthInfo() {
    return this.lastAuthInfo
  }

  async extractDetailed(repoPath, frameworkInfo, options = {}) {
    const basePath = runtimeBase(repoPath)
    const framework = String(frameworkInfo?.framework || '').toLowerCase()
    const warnings = []

    let runtimeRoutes = []
    if (['express', 'nestjs', 'nextjs', 'node'].includes(framework)) {
      const nodeResult = await this.extractNodeRuntime(basePath, options)
      runtimeRoutes = nodeResult.routes
      warnings.push(...nodeResult.warnings)
    } else if (['fastapi', 'django', 'flask', 'python'].includes(framework)) {
      const pythonResult = await this.extractPythonRuntime(basePath, framework, options)
      runtimeRoutes = pythonResult.routes
      warnings.push(...pythonResult.warnings)
    } else {
      warnings.push(`No runtime route adapter for framework ${framework || 'unknown'}`)
    }

    const sourceIndex = await this.buildSourceIndex(basePath)
    const routedWithSource = runtimeRoutes.map((route) => this.attachSourceLocation(route, sourceIndex))
    const openApi = await this.loadOpenApi(basePath, options.targetUrl)
    const mergedRoutes = this.mergeOpenApiRoutes(routedWithSource, openApi.routes)
    const authResult = await this.populateAuthRouteData(mergedRoutes, options)

    return {
      framework,
      routes: authResult.routes,
      warnings: mergeUnique(warnings, openApi.warnings),
      openApiInfo: {
        title: openApi.title,
        version: openApi.version,
      },
      authInfo: authResult.authInfo,
      packageRoots: await this.detectPackageRoots(basePath),
    }
  }

  async extractNodeRuntime(basePath, options = {}) {
    const script = this.buildNodeRuntimeScript()
    const response = await runCommand(process.execPath, ['-e', script], {
      cwd: basePath,
      env: {
        DOCKIUM_TARGET_URL: String(options.targetUrl || ''),
      },
    })

    const marker = '__DOCKIUM_ROUTE_RESULT__'
    const line = response.stdout
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(marker))

    if (!line) {
      return {
        routes: [],
        warnings: [
          `Node runtime route discovery failed (${response.code}). ${response.stderr || 'No marker output from runtime adapter.'}`,
        ],
      }
    }

    try {
      const payload = JSON.parse(line.slice(marker.length))
      const routes = asArray(payload.routes).map((route, index) => this.normalizeRuntimeRoute(route, index))
      return {
        routes,
        warnings: asArray(payload.warnings),
      }
    } catch (error) {
      return {
        routes: [],
        warnings: [
          `Node runtime route discovery parse failure: ${stringifyError(error)}`,
        ],
      }
    }
  }

  async extractPythonRuntime(basePath, framework, options = {}) {
    const script = this.buildPythonRuntimeScript(framework)
    const candidates = ['python', 'python3']

    for (const command of candidates) {
      const response = await runCommand(command, ['-c', script], {
        cwd: basePath,
        env: {
          DOCKIUM_FRAMEWORK: framework,
          DOCKIUM_TARGET_URL: String(options.targetUrl || ''),
        },
      })

      const marker = '__DOCKIUM_ROUTE_RESULT__'
      const line = response.stdout
        .split(/\r?\n/)
        .find((entry) => entry.startsWith(marker))

      if (!line) {
        continue
      }

      try {
        const payload = JSON.parse(line.slice(marker.length))
        const routes = asArray(payload.routes).map((route, index) => this.normalizeRuntimeRoute(route, index))
        return {
          routes,
          warnings: asArray(payload.warnings),
        }
      } catch (error) {
        return {
          routes: [],
          warnings: [`Python runtime route parse failure: ${stringifyError(error)}`],
        }
      }
    }

    return {
      routes: [],
      warnings: ['Python runtime route discovery unavailable. No working python executable found or script failed.'],
    }
  }

  normalizeRuntimeRoute(route, index) {
    const method = String(route?.method || 'GET').toUpperCase()
    const pathPattern = normalizePathPattern(route?.path || '/')
    const middlewareChain = asArray(route?.middlewareChain).map((item) => String(item || 'anonymous')).filter(Boolean)
    const roles = mergeUnique(asArray(route?.roles), this.rolesFromMiddleware(middlewareChain))
    const permissions = mergeUnique(asArray(route?.permissions), this.permissionsFromMiddleware(middlewareChain))
    const authRequired = Boolean(route?.authRequired) || roles.length > 0 || permissions.length > 0

    return {
      id: route?.id || `route-${index + 1}-${method}-${pathPattern}`,
      method,
      path: pathPattern,
      fullPath: pathPattern,
      handlerName: String(route?.handlerName || 'anonymous-handler'),
      middlewareChain,
      authRequired,
      roles,
      permissions,
      authSignals: asArray(route?.authSignals),
      rateLimit: route?.rateLimit || null,
      sourceFile: String(route?.sourceFile || ''),
      sourceLine: Number(route?.sourceLine || 0) || 1,
      sourceReadable: Boolean(route?.sourceFile),
      sourceWarning: route?.sourceFile ? '' : 'Source not resolved from runtime adapter',
      request: {
        pathParams: pathParamsFromPattern(pathPattern),
        queryParams: asArray(route?.queryParams).map((name) => ({ name: String(name), type: 'string', required: false })),
        bodySchema: route?.requestBodySchema || null,
      },
      response: {
        statusCodes: asArray(route?.statusCodes).length > 0 ? asArray(route.statusCodes) : [{ code: 200 }],
        bodySchema: route?.responseBodySchema || null,
        contentType: String(route?.contentType || 'application/json'),
      },
      openApi: null,
      authStatus: authRequired ? 'AUTH REQUIRED' : 'PUBLIC',
      authLive: false,
      authFailed: false,
      liveRequest: null,
      liveResponse: null,
    }
  }

  rolesFromMiddleware(chain = []) {
    const roles = []
    for (const item of chain) {
      const text = String(item || '').toLowerCase()
      if (text.includes('admin')) roles.push('admin')
      if (text.includes('staff')) roles.push('staff')
      if (text.includes('user')) roles.push('user')
    }
    return [...new Set(roles)]
  }

  permissionsFromMiddleware(chain = []) {
    const permissions = []
    for (const item of chain) {
      const text = String(item || '').toLowerCase()
      if (text.includes('read')) permissions.push('read')
      if (text.includes('write')) permissions.push('write')
      if (text.includes('delete')) permissions.push('delete')
      if (text.includes('scope')) permissions.push('scoped-access')
    }
    return [...new Set(permissions)]
  }

  async buildSourceIndex(basePath) {
    const files = await walkFiles(basePath)
    const index = new Map()

    for (const file of files) {
      let content = ''
      try {
        content = await fs.readFile(file.abs, 'utf8')
      } catch {
        continue
      }

      const lines = content.split(/\r?\n/)
      lines.forEach((line, lineNumber) => {
        const fnMatch = line.match(/function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/)
          || line.match(/const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(async\s*)?\(/)
          || line.match(/def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/)

        if (!fnMatch) {
          return
        }

        const name = fnMatch[1]
        if (!index.has(name)) {
          index.set(name, {
            file: file.rel,
            line: lineNumber + 1,
          })
        }
      })
    }

    return index
  }

  attachSourceLocation(route, sourceIndex) {
    if (route.sourceFile) {
      return {
        ...route,
        sourceFile: toPosix(route.sourceFile),
      }
    }

    const fromIndex = sourceIndex.get(route.handlerName)
    if (!fromIndex) {
      return {
        ...route,
        sourceFile: 'unresolved',
        sourceLine: 1,
        sourceReadable: false,
        sourceWarning: 'Source location unavailable',
      }
    }

    return {
      ...route,
      sourceFile: toPosix(fromIndex.file),
      sourceLine: Number(fromIndex.line || 1),
      sourceReadable: true,
      sourceWarning: '',
    }
  }

  async loadOpenApi(basePath, targetUrl = '') {
    const warnings = []
    const candidates = [
      'openapi.json',
      'swagger.json',
      path.join('docs', 'openapi.json'),
      path.join('docs', 'swagger.json'),
    ]

    for (const relative of candidates) {
      const full = path.join(basePath, relative)
      if (!(await pathExists(full))) {
        continue
      }

      try {
        const json = await readJson(full)
        const parsed = parseOpenApiJson(json)
        return { ...parsed, warnings }
      } catch (error) {
        warnings.push(`Failed to parse OpenAPI file ${toPosix(relative)}: ${stringifyError(error)}`)
      }
    }

    const base = String(targetUrl || '').trim()
    if (!base) {
      return { routes: [], title: '', version: '', warnings }
    }

    const httpCandidates = ['/openapi.json', '/swagger.json', '/v3/api-docs']
    for (const suffix of httpCandidates) {
      try {
        const response = await fetch(`${base.replace(/\/$/, '')}${suffix}`)
        if (!response.ok) {
          warnings.push(`OpenAPI endpoint ${suffix} returned HTTP ${response.status}`)
          continue
        }

        const contentType = String(response.headers.get('content-type') || '')
        const text = await response.text()
        const looksLikeJson = /json/i.test(contentType)
          || /^\s*\{/.test(text)
          || /^\s*\[/.test(text)
        if (!looksLikeJson) {
          warnings.push(`OpenAPI endpoint ${suffix} returned non-JSON content (${contentType || 'unknown'})`)
          continue
        }

        const parsedJson = safeJsonParse(text)
        if (!parsedJson.ok) {
          warnings.push(`OpenAPI endpoint ${suffix} JSON parse failed: ${stringifyError(parsedJson.error)}`)
          continue
        }

        const json = parsedJson.value
        const parsedSpec = parseOpenApiJson(json)
        return { ...parsedSpec, warnings }
      } catch (error) {
        warnings.push(`OpenAPI endpoint ${suffix} request failed: ${stringifyError(error)}`)
      }
    }

    return { routes: [], title: '', version: '', warnings }
  }

  mergeOpenApiRoutes(runtimeRoutes = [], openApiRoutes = []) {
    const map = new Map(runtimeRoutes.map((route) => [routeKey(route.method, route.path), route]))

    for (const specRoute of openApiRoutes) {
      const key = routeKey(specRoute.method, specRoute.path)
      const existing = map.get(key)

      if (!existing) {
        map.set(key, {
          id: `spec-${specRoute.method}-${specRoute.path}`,
          method: specRoute.method,
          path: specRoute.path,
          fullPath: specRoute.path,
          handlerName: specRoute.operationId || 'openapi-handler',
          middlewareChain: [],
          authRequired: asArray(specRoute.permissions).length > 0,
          roles: [],
          permissions: asArray(specRoute.permissions),
          authSignals: [],
          rateLimit: null,
          sourceFile: 'openapi-spec',
          sourceLine: 1,
          sourceReadable: true,
          sourceWarning: '',
          request: {
            pathParams: pathParamsFromPattern(specRoute.path),
            queryParams: [],
            bodySchema: specRoute.requestBodySchema,
          },
          response: {
            statusCodes: Object.keys(specRoute.responses || {}).map((code) => ({ code: Number(code) || code })),
            bodySchema: specRoute.responses,
            contentType: 'application/json',
          },
          openApi: specRoute,
          authStatus: asArray(specRoute.permissions).length > 0 ? 'AUTH REQUIRED' : 'PUBLIC',
          authLive: false,
          authFailed: false,
          liveRequest: null,
          liveResponse: null,
        })
        continue
      }

      existing.request.bodySchema = specRoute.requestBodySchema || existing.request.bodySchema
      existing.response.bodySchema = specRoute.responses || existing.response.bodySchema
      existing.permissions = mergeUnique(existing.permissions, specRoute.permissions)
      existing.openApi = specRoute
      existing.authRequired = existing.authRequired || existing.permissions.length > 0
      existing.authStatus = authTagForRoute(existing)
      map.set(key, existing)
    }

    return [...map.values()].sort((a, b) => {
      const pathCmp = a.path.localeCompare(b.path)
      if (pathCmp !== 0) return pathCmp
      return METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method)
    })
  }

  buildLoginPayloadCandidates(credentials = {}) {
    const email = String(credentials?.adminEmail || credentials?.testUserEmail || '').trim()
    const password = String(credentials?.adminPassword || credentials?.testUserPass || '').trim()
    if (!email || !password) {
      return []
    }

    return [
      { email, password },
      { username: email, password },
      { user: email, password },
      { identifier: email, password },
      { login: email, password },
      { credentials: { email, password } },
    ]
  }

  isLikelyLoginRoute(route) {
    const method = String(route?.method || 'GET').toUpperCase()
    const routePath = String(route?.path || '').toLowerCase()
    if (method !== 'POST') {
      return false
    }
    return /(login|signin|auth|session|token)/i.test(routePath)
  }

  async attemptAutoLogin(routes = [], targetUrl = '', credentials = {}) {
    const base = String(targetUrl || '').trim().replace(/\/$/, '')
    if (!base) {
      return {
        ok: false,
        token: '',
        source: 'none',
        endpoint: '',
        message: 'Missing target URL for automatic authentication.',
      }
    }

    const loginRoutes = routes.filter((route) => this.isLikelyLoginRoute(route))
    const payloads = this.buildLoginPayloadCandidates(credentials)
    if (!loginRoutes.length || !payloads.length) {
      return {
        ok: false,
        token: '',
        source: 'none',
        endpoint: '',
        message: 'No login endpoint or credentials available for automatic authentication.',
      }
    }

    for (const route of loginRoutes) {
      const loginPath = String(route?.path || '/').replace(/:([A-Za-z0-9_]+)/g, '1')
      const loginUrl = `${base}${loginPath.startsWith('/') ? loginPath : `/${loginPath}`}`
      for (const payload of payloads) {
        try {
          const response = await fetch(loginUrl, {
            method: 'POST',
            headers: {
              Accept: 'application/json, text/plain;q=0.8, */*;q=0.5',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          })

          const text = await response.text()
          const parsed = safeJsonParse(text)
          const fromBody = parsed.ok ? extractTokenFromPayload(parsed.value) : ''
          if (fromBody) {
            return {
              ok: true,
              token: fromBody,
              source: 'auto-login-token',
              endpoint: loginPath,
              message: `Token obtained from ${loginPath}.`,
            }
          }

          const cookieHeader = toCookieHeader(getSetCookieValues(response))
          if (cookieHeader) {
            return {
              ok: true,
              token: cookieHeader,
              source: 'auto-login-cookie',
              endpoint: loginPath,
              message: `Session cookie obtained from ${loginPath}.`,
            }
          }
        } catch {
          // Try next candidate.
        }
      }
    }

    return {
      ok: false,
      token: '',
      source: 'none',
      endpoint: '',
      message: 'Automatic login failed for discovered auth endpoints.',
    }
  }

  async populateAuthRouteData(routes = [], options = {}) {
    const targetUrl = String(options.targetUrl || '').trim()
    let resolvedToken = String(options.authToken || options.token || '').trim()
    let authInfo = {
      mode: resolvedToken ? 'manual-token' : 'none',
      source: resolvedToken ? 'manual' : 'none',
      success: Boolean(resolvedToken),
      endpoint: '',
      message: resolvedToken
        ? 'Manual authentication token applied.'
        : 'No authentication token provided.',
    }

    if (!resolvedToken && options.autoAuth && targetUrl) {
      const autoResult = await this.attemptAutoLogin(routes, targetUrl, options.credentials || {})
      if (autoResult.ok) {
        resolvedToken = autoResult.token
        authInfo = {
          mode: 'auto-login',
          source: autoResult.source,
          success: true,
          endpoint: autoResult.endpoint,
          message: autoResult.message,
        }
      } else {
        authInfo = {
          mode: 'auto-login',
          source: 'none',
          success: false,
          endpoint: '',
          message: autoResult.message,
        }
      }
    }

    if (!resolvedToken || !targetUrl) {
      const untouched = routes.map((route) => ({ ...route, authStatus: authTagForRoute(route) }))
      this.lastAuthInfo = authInfo
      return { routes: untouched, authInfo }
    }

    const headers = buildTokenHeaders(resolvedToken)
    const concurrent = 4
    const queue = [...routes]
    const output = []

    const worker = async () => {
      while (queue.length > 0) {
        const route = queue.shift()
        if (!route) {
          continue
        }

        if (!route.authRequired) {
          output.push({ ...route, authStatus: authTagForRoute(route) })
          continue
        }

        const tested = await this.liveProbeRoute(route, targetUrl, headers)
        output.push(tested)
      }
    }

    await Promise.all(Array.from({ length: concurrent }, () => worker()))
    const sorted = output.sort((a, b) => routeKey(a.method, a.path).localeCompare(routeKey(b.method, b.path)))
    this.lastAuthInfo = authInfo
    return { routes: sorted, authInfo }
  }

  async liveProbeRoute(route, targetUrl, authHeaders, requestOverrides = {}) {
    const overridePathParams = asArray(requestOverrides?.pathParams || requestOverrides?.params).map((param, index) => ({
      name: String(param?.name || `param${index + 1}`),
      sample: String(param?.value || param?.sample || index + 1),
    }))
    const overrideQueryParams = asArray(requestOverrides?.queryParams).map((param, index) => ({
      name: String(param?.name || `q${index + 1}`),
      value: String(param?.value || param?.sample || 'sample'),
      type: String(param?.type || 'string'),
    }))
    const pathParams = overridePathParams.length > 0 ? overridePathParams : route.request.pathParams
    const queryParams = overrideQueryParams.length > 0 ? overrideQueryParams : route.request.queryParams
    const testPath = substitutePathParams(route.path, pathParams)
    const querySuffix = buildQueryString(queryParams)
    const url = `${targetUrl.replace(/\/$/, '')}${testPath}${querySuffix}`
    const method = String(requestOverrides?.method || route.method || 'GET').toUpperCase()
    const customBody = requestOverrides?.body
    const requestBody = ['POST', 'PUT', 'PATCH'].includes(method)
      ? (customBody !== undefined
        ? customBody
        : (route.request.bodySchema ? this.sampleFromSchema(route.request.bodySchema) : {}))
      : null

    const extraHeaders = requestOverrides?.headers && typeof requestOverrides.headers === 'object'
      ? requestOverrides.headers
      : {}

    const requestInit = {
      method,
      headers: {
        Accept: 'application/json, text/plain;q=0.8, */*;q=0.5',
        ...authHeaders,
        ...extraHeaders,
      },
    }

    if (requestBody && method !== 'GET' && method !== 'HEAD') {
      requestInit.headers['Content-Type'] = 'application/json'
      requestInit.body = JSON.stringify(requestBody)
    }

    try {
      const response = await fetch(url, requestInit)
      const responseText = await response.text()
      const decoded = decodeBody(responseText)

      const rateLimit = {
        limit: response.headers.get('x-ratelimit-limit') || '',
        remaining: response.headers.get('x-ratelimit-remaining') || '',
        reset: response.headers.get('x-ratelimit-reset') || '',
      }

      const authFailed = response.status === 401 || response.status === 403
      return {
        ...route,
        authFailed,
        authLive: !authFailed,
        authStatus: authFailed ? 'AUTH FAILED' : 'AUTHED + LIVE DATA',
        rateLimit: rateLimit.limit || rateLimit.remaining || rateLimit.reset ? rateLimit : route.rateLimit,
        liveRequest: {
          url,
          method,
          pathParams,
          queryParams,
          headers: requestInit.headers,
          body: requestBody,
        },
        liveResponse: {
          statusCode: response.status,
          contentType: response.headers.get('content-type') || route.response.contentType,
          headers: Object.fromEntries(response.headers.entries()),
          bodyPreview: decoded.raw.slice(0, 3000),
        },
        response: {
          ...route.response,
          bodySchema: decoded.json ? inferSchema(decoded.json) : route.response.bodySchema,
          statusCodes: [{ code: response.status }],
          contentType: response.headers.get('content-type') || route.response.contentType,
        },
      }
    } catch (error) {
      return {
        ...route,
        authFailed: true,
        authLive: false,
        authStatus: 'AUTH FAILED',
        liveRequest: {
          url,
          method,
          pathParams,
          queryParams,
          headers: requestInit.headers,
          body: requestBody,
        },
        liveResponse: {
          statusCode: 0,
          contentType: 'unknown',
          bodyPreview: stringifyError(error),
        },
      }
    }
  }

  sampleFromSchema(schema) {
    if (!schema || typeof schema !== 'object') {
      return {}
    }

    if (schema.type === 'array') {
      return [this.sampleFromSchema(schema.items || { type: 'string' })]
    }

    if (schema.type === 'object' || schema.properties) {
      const sample = {}
      for (const [key, value] of Object.entries(schema.properties || {})) {
        sample[key] = this.sampleFromSchema(value)
      }
      return sample
    }

    if (schema.type === 'number' || schema.type === 'integer') return 1
    if (schema.type === 'boolean') return true
    if (schema.type === 'null') return null
    return 'sample'
  }

  async detectPackageRoots(basePath) {
    const packages = []
    const queue = ['']
    const seen = new Set()

    while (queue.length > 0) {
      const rel = queue.shift() || ''
      const current = path.join(basePath, rel)
      if (seen.has(current)) {
        continue
      }
      seen.add(current)

      let entries = []
      try {
        entries = await fs.readdir(current, { withFileTypes: true })
      } catch {
        continue
      }

      const manifest = entries.find((entry) =>
        entry.isFile() && ['package.json', 'pyproject.toml', 'go.mod'].includes(entry.name)
      )

      if (manifest) {
        const packageName = rel ? toPosix(rel) : path.basename(basePath)
        packages.push({
          name: packageName,
          root: rel ? toPosix(rel) : '.',
          manifest: manifest.name,
        })
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name)) {
          continue
        }
        queue.push(path.join(rel, entry.name))
      }
    }

    if (packages.length === 0) {
      return [{ name: path.basename(basePath), root: '.', manifest: '' }]
    }

    return packages.sort((a, b) => a.root.localeCompare(b.root))
  }

  buildNodeRuntimeScript() {
    return `
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const http = require('http')
const https = require('https')

const warnings = []
const marker = '__DOCKIUM_ROUTE_RESULT__'

http.Server.prototype.listen = function patchedListen() { return this }
https.Server.prototype.listen = function patchedListen() { return this }

function joinPath(prefix, mount) {
  const cleanPrefix = String(prefix || '').replace(/\/+$/, '')
  const cleanMount = String(mount || '').replace(/^\/+/, '')
  const result = \`\${cleanPrefix}/\${cleanMount}\`.replace(/\/+/g, '/')
  return result.startsWith('/') ? result : '/' + result
}

function mountFromLayer(layer) {
  if (typeof layer.path === 'string') {
    return layer.path
  }
  if (layer.regexp && layer.regexp.fast_slash) {
    return ''
  }
  const raw = String(layer.regexp?.source || '')
    .replace('^\\\\', '')
    .replace('\\\\/?(?=\\\\/|$)', '')
    .replace('(?=\\\\/|$)', '')
    .replace(/\\\\\//g, '/')
    .replace(/\$$/, '')
  if (!raw || raw === '^') return ''
  return raw.startsWith('/') ? raw : '/' + raw
}

function middlewareName(layer) {
  const name = String(layer?.name || layer?.handle?.name || 'anonymous')
  return name === '<anonymous>' ? 'anonymous' : name
}

function isAuthName(value) {
  return /(auth|jwt|passport|session|guard|role|permission|acl|scope|csrf)/i.test(String(value || ''))
}

function walkStack(stack, prefix = '', parentMiddleware = [], depth = 0, out = []) {
  if (!Array.isArray(stack) || depth > 64) {
    return out
  }

  let chain = [...parentMiddleware]
  for (const layer of stack) {
    if (!layer) continue
    const layerName = middlewareName(layer)

    if (layer.route) {
      const routePath = joinPath(prefix, layer.route.path || '')
      const methods = Object.keys(layer.route.methods || {}).filter((key) => layer.route.methods[key])
      const routeStack = Array.isArray(layer.route.stack) ? layer.route.stack : []
      const routeMiddleware = routeStack.map((entry) => middlewareName(entry))
      const mergedChain = [...chain, ...routeMiddleware]
      const handler = routeStack[routeStack.length - 1]

      for (const method of methods.length > 0 ? methods : ['get']) {
        out.push({
          method: String(method).toUpperCase(),
          path: routePath,
          handlerName: middlewareName(handler),
          middlewareChain: mergedChain,
          authRequired: mergedChain.some((name) => isAuthName(name)) || isAuthName(routePath),
          authSignals: mergedChain.filter((name) => isAuthName(name)),
          sourceFile: '',
          sourceLine: 1,
          queryParams: [],
          requestBodySchema: null,
          responseBodySchema: null,
          contentType: 'application/json',
          statusCodes: [{ code: 200 }],
        })
      }
      continue
    }

    if (layer.handle && Array.isArray(layer.handle.stack)) {
      const mount = mountFromLayer(layer)
      const nextPrefix = joinPath(prefix, mount)
      const nextChain = [...chain]
      if (layerName !== 'router') {
        nextChain.push(layerName)
      }
      walkStack(layer.handle.stack, nextPrefix, nextChain, depth + 1, out)
      continue
    }

    chain = [...chain, layerName]
  }

  return out
}

function looksLikeRouter(value) {
  return Boolean(value && typeof value === 'function' && value.stack) || Boolean(value && value._router && value._router.stack)
}

function collectEntrypoints(cwd) {
  const out = []
  const packagePath = path.join(cwd, 'package.json')
  if (fs.existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
      if (pkg.main) out.push(pkg.main)
      const start = String(pkg.scripts?.start || '')
      const tokens = start.split(/\s+/).filter(Boolean)
      for (let i = 0; i < tokens.length - 1; i += 1) {
        if (/^(node|tsx|ts-node|nodemon)$/i.test(tokens[i])) {
          out.push(tokens[i + 1])
        }
      }
    } catch (error) {
      warnings.push('Failed to parse package.json: ' + error.message)
    }
  }

  out.push('server.js', 'app.js', 'index.js', 'src/server.js', 'src/app.js', 'src/index.js')
  return [...new Set(out)]
}

async function loadModule(filePath) {
  try {
    return require(filePath)
  } catch {
    try {
      return await import(pathToFileURL(filePath).href)
    } catch (error) {
      warnings.push('Failed loading ' + filePath + ': ' + error.message)
      return null
    }
  }
}

function findRouterCandidate(value, seen = new Set()) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null
  if (seen.has(value)) return null
  seen.add(value)

  if (looksLikeRouter(value)) return value
  for (const child of Object.values(value)) {
    const found = findRouterCandidate(child, seen)
    if (found) return found
  }
  return null
}

;(async () => {
  const cwd = process.cwd()
  const entries = collectEntrypoints(cwd)
  const routes = []

  for (const entry of entries) {
    const absolute = path.resolve(cwd, entry)
    if (!fs.existsSync(absolute)) continue
    const loaded = await loadModule(absolute)
    if (!loaded) continue

    const root = findRouterCandidate(loaded)
    if (!root) continue

    const stack = root._router?.stack || root.stack || []
    walkStack(stack, '', [], 0, routes)
    if (routes.length > 0) {
      break
    }
  }

  process.stdout.write(marker + JSON.stringify({ routes, warnings }) + '\\n')
})().catch((error) => {
  process.stdout.write(marker + JSON.stringify({ routes: [], warnings: ['Node adapter crash: ' + error.message] }) + '\\n')
})
`
  }

  buildPythonRuntimeScript(framework) {
    const safeFramework = String(framework || 'python')
    return `
import importlib
import inspect
import json
import os
import pathlib
import sys

MARKER = '__DOCKIUM_ROUTE_RESULT__'
warnings = []
framework = ${JSON.stringify(safeFramework)}

def norm_path(value):
    raw = str(value or '/').strip()
    if not raw:
        return '/'
    if not raw.startswith('/'):
        raw = '/' + raw
    return raw.replace('<', ':').replace('>', '').replace('//', '/')

def module_candidates(cwd):
    out = []
    app_module = os.getenv('APP_MODULE')
    if app_module:
        out.append(app_module)
    out.extend(['main', 'app', 'src.main', 'src.app'])
    return out

def emit(routes):
    print(MARKER + json.dumps({'routes': routes, 'warnings': warnings}))

def scan_fastapi(cwd):
    from fastapi.routing import APIRoute
    routes = []
    app_obj = None
    for candidate in module_candidates(cwd):
        try:
            module = importlib.import_module(candidate)
            app_obj = getattr(module, 'app', None)
            if app_obj is not None:
                break
        except Exception as ex:
            warnings.append(f'FastAPI module load failed for {candidate}: {ex}')

    if app_obj is None:
        return []

    app_middlewares = []
    for middleware in getattr(app_obj, 'user_middleware', []) or []:
        app_middlewares.append(getattr(getattr(middleware, 'cls', None), '__name__', 'middleware'))

    for route in getattr(app_obj, 'routes', []) or []:
        if not isinstance(route, APIRoute):
            continue
        endpoint = route.endpoint
        source_file = ''
        source_line = 1
        try:
            source_file = os.path.relpath(inspect.getsourcefile(endpoint) or '', cwd).replace('\\\\', '/')
            source_line = inspect.getsourcelines(endpoint)[1]
        except Exception:
            source_file = ''

        methods = sorted([method.upper() for method in (route.methods or ['GET']) if method.upper() != 'HEAD'])
        dependencies = []
        for dep in getattr(route, 'dependencies', []) or []:
            dep_name = getattr(getattr(dep, 'dependency', None), '__name__', 'dependency')
            dependencies.append(dep_name)

        chain = app_middlewares + dependencies + [getattr(endpoint, '__name__', 'handler')]
        auth_required = any('auth' in item.lower() or 'security' in item.lower() for item in chain)
        status_codes = [{'code': route.status_code or 200}]

        for method in methods:
            routes.append({
                'method': method,
                'path': norm_path(route.path),
                'handlerName': getattr(endpoint, '__name__', 'handler'),
                'middlewareChain': chain,
                'authRequired': auth_required,
                'authSignals': [item for item in chain if 'auth' in item.lower() or 'security' in item.lower()],
                'sourceFile': source_file,
                'sourceLine': source_line,
                'queryParams': [param.name for param in getattr(route.dependant, 'query_params', []) or []],
                'requestBodySchema': None,
                'responseBodySchema': None,
                'contentType': 'application/json',
                'statusCodes': status_codes,
            })
    return routes

def scan_django(cwd):
    routes = []
    settings_module = os.getenv('DJANGO_SETTINGS_MODULE')
    if not settings_module:
        for root, dirs, files in os.walk(cwd):
            if 'settings.py' in files:
                candidate = os.path.relpath(root, cwd).replace('\\\\', '.')
                settings_module = (candidate + '.settings').strip('.')
                break

    if not settings_module:
        warnings.append('DJANGO_SETTINGS_MODULE was not found')
        return []

    os.environ.setdefault('DJANGO_SETTINGS_MODULE', settings_module)
    try:
        import django
        from django.urls import URLPattern, URLResolver, get_resolver
        django.setup()
    except Exception as ex:
        warnings.append(f'Django setup failed: {ex}')
        return []

    def walk(patterns, prefix=''):
        for entry in patterns:
            if isinstance(entry, URLResolver):
                walk(entry.url_patterns, prefix + str(entry.pattern))
            elif isinstance(entry, URLPattern):
                callback = entry.callback
                methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
                if hasattr(callback, 'view_class'):
                    names = getattr(callback.view_class, 'http_method_names', []) or []
                    methods = [name.upper() for name in names if name and name.lower() not in {'options', 'head'}]
                source_file = ''
                source_line = 1
                try:
                    source_file = os.path.relpath(inspect.getsourcefile(callback) or '', cwd).replace('\\\\', '/')
                    source_line = inspect.getsourcelines(callback)[1]
                except Exception:
                    source_file = ''

                callback_name = getattr(callback, '__name__', getattr(callback, '__qualname__', 'handler'))
                auth_required = 'login_required' in callback_name or 'permission' in callback_name
                route_path = norm_path(prefix + str(entry.pattern))
                for method in methods or ['GET']:
                    routes.append({
                        'method': method,
                        'path': route_path,
                        'handlerName': callback_name,
                        'middlewareChain': [callback_name],
                        'authRequired': auth_required,
                        'authSignals': [callback_name] if auth_required else [],
                        'sourceFile': source_file,
                        'sourceLine': source_line,
                        'queryParams': [],
                        'requestBodySchema': None,
                        'responseBodySchema': None,
                        'contentType': 'application/json',
                        'statusCodes': [{'code': 200}],
                    })

    from django.urls import get_resolver
    resolver = get_resolver()
    walk(resolver.url_patterns, '')
    return routes

def main():
    cwd = os.getcwd()
    if cwd not in sys.path:
        sys.path.insert(0, cwd)

    routes = []
    if framework in {'fastapi', 'flask', 'python'}:
        try:
            routes = scan_fastapi(cwd)
        except Exception as ex:
            warnings.append(f'FastAPI adapter failed: {ex}')
    if (not routes) and framework in {'django', 'python'}:
        try:
            routes = scan_django(cwd)
        except Exception as ex:
            warnings.append(f'Django adapter failed: {ex}')

    emit(routes)

if __name__ == '__main__':
    main()
`
  }
}

export default RouteExtractor
