import HttpMitmProxy from 'http-mitm-proxy'
import RequestCapture from './RequestCapture.js'
import RequestModifier from './RequestModifier.js'
import ZapBridge from './ZapBridge.js'

class ProxyEngine {
  constructor(config) {
    this.config = config
    this.port = 8080
    this.proxy = new HttpMitmProxy()
    this.intercepting = false
    this.running = false
    this.capture = new RequestCapture(10000)
    this.modifier = new RequestModifier()
    this.zapBridge = new ZapBridge()
    this.wss = config?.wss || null
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
      this.proxy.listen(this.port, () => {
        this.running = true
        console.log('[ProxyEngine] Proxy listening on port', this.port)
        resolve()
      })
    })
  }

  async stop() {
    if (!this.running) {
      return
    }

    return new Promise((resolve) => {
      this.proxy.close(() => {
        this.running = false
        console.log('[ProxyEngine] Proxy stopped')
        resolve()
      })
    })
  }

  onRequest(ctx) {
    const request = this.capture.capture({
      method: ctx.clientToProxyRequest.method,
      host: ctx.clientToProxyRequest.headers.host,
      path: ctx.clientToProxyRequest.url,
      requestHeaders: ctx.clientToProxyRequest.headers,
      requestBody: '',
      responseStatus: 0,
      responseHeaders: {},
      responseBody: '',
      durationMs: 0
    })

    ctx.__dockiumRequestId = request.id

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
      if (matching.flag !== 'normal') {
        this.zapBridge.forwardRequest(matching).catch(() => {})
      }
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
      status: item.responseStatus,
      responseStatus: item.responseStatus,
      responseHeaders: item.responseHeaders,
      responseBody: item.responseBody,
      requestHeaders: item.requestHeaders,
      requestBody: item.requestBody,
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
      port: this.port,
      requestCount: this.capture.getAll().length
    }
  }
}

export default ProxyEngine
