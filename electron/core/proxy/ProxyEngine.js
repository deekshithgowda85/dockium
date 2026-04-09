import HttpMitmProxy from 'http-mitm-proxy'
import RequestCapture from './RequestCapture.js'
import RequestModifier from './RequestModifier.js'

const MAX_CAPTURE_BYTES = 256 * 1024

function clipBufferParts(parts = []) {
  const source = Array.isArray(parts) ? parts : []
  let total = 0
  const output = []

  for (const part of source) {
    if (!part) {
      continue
    }

    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part)
    if (total >= MAX_CAPTURE_BYTES) {
      break
    }

    const remaining = MAX_CAPTURE_BYTES - total
    const clipped = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
    output.push(clipped)
    total += clipped.length
  }

  return {
    buffer: output.length > 0 ? Buffer.concat(output) : Buffer.from(''),
    bytes: total,
  }
}

function normalizeContentType(headers = {}) {
  const raw = headers?.['content-type'] || headers?.['Content-Type'] || ''
  return String(Array.isArray(raw) ? raw[0] : raw).toLowerCase()
}

function inferFormat(headers = {}, body = '') {
  const contentType = normalizeContentType(headers)
  const sample = String(body || '').trim().slice(0, 80)

  if (!sample && !contentType) return 'empty'
  if (contentType.includes('application/json') || /^[\[{]/.test(sample)) return 'json'
  if (contentType.includes('application/x-www-form-urlencoded')) return 'form-urlencoded'
  if (contentType.includes('multipart/form-data')) return 'multipart'
  if (contentType.includes('application/xml') || contentType.includes('text/xml') || /^<\?xml|^</.test(sample)) return 'xml-html'
  if (contentType.includes('text/html')) return 'html'
  if (contentType.includes('text/')) return 'text'
  if (contentType.includes('application/jwt') || /^eyJ[A-Za-z0-9_-]+\./.test(sample)) return 'jwt'
  if (contentType.startsWith('image/') || contentType.includes('octet-stream')) return 'binary'
  return contentType || 'unknown'
}

function toSafeText(buffer, format) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return ''
  }

  if (format === 'binary') {
    return `[binary content omitted: ${buffer.length} bytes]`
  }

  return buffer.toString('utf8')
}

function toHeaderLines(headers = {}) {
  return Object.entries(headers || {})
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('; ') : value}`)
    .join('\n')
}

function toRequestRaw(method, path, headers, body) {
  const startLine = `${String(method || 'GET').toUpperCase()} ${path || '/'} HTTP/1.1`
  const headerLines = toHeaderLines(headers)
  return `${startLine}\n${headerLines}${body ? `\n\n${body}` : ''}`
}

function toResponseRaw(status, headers, body) {
  const startLine = `HTTP/1.1 ${Number(status || 0)} ${Number(status || 0) >= 400 ? 'ERROR' : 'OK'}`
  const headerLines = toHeaderLines(headers)
  return `${startLine}\n${headerLines}${body ? `\n\n${body}` : ''}`
}

class ProxyEngine {
  constructor(config) {
    this.config = config
    this.port = 8080
    this.proxy = new HttpMitmProxy()
    this.intercepting = false
    this.running = false
    this.capture = new RequestCapture(10000)
    this.modifier = new RequestModifier()
    this.wss = config?.wss || null
    this.host = '0.0.0.0'
    this.originalFetch = null
  }

  patchGlobalFetchCapture() {
    if (this.originalFetch || typeof globalThis.fetch !== 'function') {
      return
    }

    this.originalFetch = globalThis.fetch.bind(globalThis)
    const engine = this

    globalThis.fetch = async function dockiumProxyCapturedFetch(input, init = {}) {
      const original = engine.originalFetch || globalThis.fetch
      const method = String(init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase()
      let urlValue = ''

      try {
        if (typeof input === 'string') {
          urlValue = input
        } else if (input && typeof input === 'object' && input.url) {
          urlValue = String(input.url)
        }
      } catch {
        urlValue = ''
      }

      const isHttp = /^https?:\/\//i.test(urlValue)
      if (!isHttp || !engine.running) {
        return original(input, init)
      }

      const startedAt = Date.now()
      let parsed
      try {
        parsed = new URL(urlValue)
      } catch {
        return original(input, init)
      }

      const reqBodyRaw = init?.body
      const reqBody = Buffer.isBuffer(reqBodyRaw)
        ? reqBodyRaw.toString('utf8')
        : typeof reqBodyRaw === 'string'
          ? reqBodyRaw
          : reqBodyRaw && typeof reqBodyRaw === 'object'
            ? JSON.stringify(reqBodyRaw)
            : ''

      const reqHeaders = init?.headers && typeof init.headers === 'object'
        ? init.headers
        : {}

      const request = engine.capture.capture({
        method,
        host: parsed.host,
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        requestHeaders: reqHeaders,
        requestBody: clipBufferParts([Buffer.from(String(reqBody || ''))]).buffer.toString('utf8'),
        requestFormat: inferFormat(reqHeaders, reqBody),
        requestBytes: Buffer.byteLength(String(reqBody || ''), 'utf8'),
        responseStatus: 0,
        responseHeaders: {},
        responseBody: '',
        responseFormat: 'empty',
        responseBytes: 0,
        durationMs: 0,
      })

      engine.wss?.emit('request', request)

      try {
        const response = await original(input, init)
        let responseText = ''
        try {
          responseText = await response.clone().text()
        } catch {
          responseText = ''
        }

        const responseHeaders = Object.fromEntries(response.headers?.entries?.() || [])
        const responseData = clipBufferParts([Buffer.from(String(responseText || ''))])
        const responseFormat = inferFormat(responseHeaders, responseData.buffer.toString('utf8'))
        const responseBody = toSafeText(responseData.buffer, responseFormat)

        const updated = engine.capture.update(request.id, {
          responseStatus: Number(response.status || 0),
          responseHeaders,
          responseBody,
          responseFormat,
          responseBytes: responseData.bytes,
          responseRaw: toResponseRaw(response.status, responseHeaders, responseBody),
          durationMs: Math.max(0, Date.now() - startedAt),
        })

        if (updated) {
          engine.wss?.emit('request', updated)
        }

        return response
      } catch (error) {
        const updated = engine.capture.update(request.id, {
          responseStatus: 0,
          responseHeaders: {},
          responseBody: String(error?.message || 'fetch failed'),
          responseFormat: 'text',
          responseBytes: Buffer.byteLength(String(error?.message || ''), 'utf8'),
          responseRaw: toResponseRaw(0, {}, String(error?.message || 'fetch failed')),
          durationMs: Math.max(0, Date.now() - startedAt),
        })

        if (updated) {
          engine.wss?.emit('request', updated)
        }
        throw error
      }
    }
  }

  unpatchGlobalFetchCapture() {
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch
      this.originalFetch = null
    }
  }

  async start() {
    if (this.running) {
      return
    }

    console.log('[ProxyEngine] Starting proxy on port', this.port)

    this.proxy.onRequest((ctx, callback) => {
      this.onRequest(ctx)
      callback()
    })

    this.proxy.onResponse((ctx, callback) => {
      this.onResponse(ctx)
      callback()
    })

    return new Promise((resolve) => {
      const onReady = () => {
        this.running = true
        console.log('[ProxyEngine] Proxy listening on', `${this.host}:${this.port}`)
        resolve()
      }

      try {
        this.proxy.listen({ host: this.host, port: this.port }, onReady)
      } catch {
        this.proxy.listen(this.port, onReady)
      }
    })
      .then(() => {
        this.patchGlobalFetchCapture()
      })
  }

  async stop() {
    if (!this.running && !this.proxy?.httpServer) {
      return
    }

    try {
      if (this.proxy?.httpServer && typeof this.proxy.close === 'function') {
        this.proxy.close()
      }
    } catch (error) {
      console.warn('[ProxyEngine] Proxy stop warning:', String(error?.message || error))
    } finally {
      this.unpatchGlobalFetchCapture()
      this.running = false
      this.proxy = new HttpMitmProxy()
      console.log('[ProxyEngine] Proxy stopped')
    }
  }

  onRequest(ctx) {
    const startedAt = Date.now()
    const host = ctx.clientToProxyRequest.headers.host
    const path = ctx.clientToProxyRequest.url

    const request = this.capture.capture({
      method: ctx.clientToProxyRequest.method,
      host,
      path,
      requestHeaders: ctx.clientToProxyRequest.headers,
      requestBody: '',
      requestFormat: 'empty',
      requestBytes: 0,
      responseStatus: 0,
      responseHeaders: {},
      responseBody: '',
      responseFormat: 'empty',
      responseBytes: 0,
      durationMs: 0
    })

    ctx.__dockiumRequestId = request.id
    ctx.__dockiumMeta = {
      startedAt,
      requestChunks: [],
      responseChunks: [],
      host,
      path,
    }

    if (typeof ctx.onRequestData === 'function') {
      ctx.onRequestData((innerCtx, chunk, callback) => {
        innerCtx.__dockiumMeta?.requestChunks?.push(chunk)
        callback(null, chunk)
      })
    }

    if (typeof ctx.onResponseData === 'function') {
      ctx.onResponseData((innerCtx, chunk, callback) => {
        innerCtx.__dockiumMeta?.responseChunks?.push(chunk)
        callback(null, chunk)
      })
    }

    if (typeof ctx.onRequestEnd === 'function') {
      ctx.onRequestEnd((innerCtx, callback) => {
        const meta = innerCtx.__dockiumMeta || {}
        const headers = innerCtx.clientToProxyRequest?.headers || {}
        const requestData = clipBufferParts(meta.requestChunks || [])
        const requestFormat = inferFormat(headers, requestData.buffer.toString('utf8'))
        const requestBody = toSafeText(requestData.buffer, requestFormat)

        const updated = this.capture.update(innerCtx.__dockiumRequestId, {
          requestBody,
          requestFormat,
          requestBytes: requestData.bytes,
          requestRaw: toRequestRaw(innerCtx.clientToProxyRequest?.method, meta.path, headers, requestBody),
        })

        if (updated) {
          this.wss?.emit('request', updated)
        }
        callback()
      })
    }

    if (typeof ctx.onResponseEnd === 'function') {
      ctx.onResponseEnd((innerCtx, callback) => {
        const meta = innerCtx.__dockiumMeta || {}
        const statusCode = innerCtx.serverToClientResponse?.statusCode || 0
        const headers = innerCtx.serverToClientResponse?.headers || {}
        const responseData = clipBufferParts(meta.responseChunks || [])
        const responseFormat = inferFormat(headers, responseData.buffer.toString('utf8'))
        const responseBody = toSafeText(responseData.buffer, responseFormat)

        const updated = this.capture.update(innerCtx.__dockiumRequestId, {
          responseStatus: statusCode,
          responseHeaders: headers,
          responseBody,
          responseFormat,
          responseBytes: responseData.bytes,
          responseRaw: toResponseRaw(statusCode, headers, responseBody),
          durationMs: Math.max(0, Date.now() - Number(meta.startedAt || Date.now())),
        })

        if (updated) {
          this.wss?.emit('request', updated)
        }
        callback()
      })
    }

    if (this.intercepting && this.shouldIntercept(request)) {
      ctx.onError = () => true // Intercept
    }

    this.wss?.emit('request', request)
  }

  onResponse(ctx) {
    const requestId = ctx.__dockiumRequestId
    const matching = this.capture.update(requestId, {
      responseStatus: ctx.serverToClientResponse.statusCode,
      responseHeaders: ctx.serverToClientResponse.headers
    })

    if (matching) {
      this.wss?.emit('request', matching)
    }
  }

  async replay(request, modifications = {}) {
    const replayedRaw = await this.modifier.replay(request, modifications)
    const replayed = this.capture.capture(replayedRaw)
    this.wss?.emit('request', replayed)
    return replayed
  }

  shouldIntercept(request) {
    // Check if request should be intercepted
    const patterns = [
      '/api/',
      '/admin/',
      '/auth/'
    ]
    return patterns.some(p => request.path.includes(p))
  }

  setIntercepting(enabled) {
    this.intercepting = enabled
    console.log(`[ProxyEngine] Intercepting ${enabled ? 'enabled' : 'disabled'}`)
  }

  getRequests() {
    return this.capture.getAll().map((item) => ({
      id: item.id,
      method: item.method,
      host: item.host,
      path: item.path,
      direction: 'in-out',
      status: item.responseStatus,
      responseStatus: item.responseStatus,
      responseHeaders: item.responseHeaders,
      responseBody: item.responseBody,
      responseFormat: item.responseFormat || inferFormat(item.responseHeaders, item.responseBody),
      responseBytes: Number(item.responseBytes || 0),
      responseRaw: item.responseRaw || toResponseRaw(item.responseStatus, item.responseHeaders, item.responseBody),
      requestHeaders: item.requestHeaders,
      requestBody: item.requestBody,
      requestFormat: item.requestFormat || inferFormat(item.requestHeaders, item.requestBody),
      requestBytes: Number(item.requestBytes || 0),
      requestRaw: item.requestRaw || toRequestRaw(item.method, item.path, item.requestHeaders, item.requestBody),
      durationMs: item.durationMs,
      flag: item.flag,
      jwtDecoded: item.jwtDecoded,
      timestamp: item.timestamp
    }))
  }

  clearRequests() {
    this.capture.clear()
  }

  getStatus() {
    return {
      running: this.running,
      intercepting: this.intercepting,
      host: this.host,
      port: this.port,
      requestCount: this.capture.getAll().length
    }
  }
}

export default ProxyEngine
