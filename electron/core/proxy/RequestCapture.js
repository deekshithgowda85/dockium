class RequestCapture {
  constructor(limit = 10000) {
    this.limit = limit
    this.requests = []
    this.nextId = 1
  }

  capture(raw) {
    const entry = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      method: raw.method || 'GET',
      host: raw.host || 'localhost',
      path: raw.path || '/',
      requestHeaders: raw.requestHeaders || {},
      requestBody: raw.requestBody || '',
      responseStatus: raw.responseStatus || 0,
      responseHeaders: raw.responseHeaders || {},
      responseBody: raw.responseBody || '',
      durationMs: raw.durationMs || 0,
      flag: this.flag(raw),
      jwtDecoded: this.decodeJwt(raw)
    }

    this.requests.push(entry)
    if (this.requests.length > this.limit) this.requests.shift()
    return entry
  }

  update(id, patch) {
    const idx = this.requests.findIndex((item) => item.id === id)
    if (idx === -1) return null
    this.requests[idx] = { ...this.requests[idx], ...patch }
    this.requests[idx].flag = this.flag(this.requests[idx])
    this.requests[idx].jwtDecoded = this.decodeJwt(this.requests[idx])
    return this.requests[idx]
  }

  getAll() {
    return this.requests
  }

  clear() {
    this.requests = []
  }

  flag(request) {
    const path = String(request.path || '').toLowerCase()
    const body = String(request.requestBody || '').toLowerCase()
    const status = Number(request.responseStatus || request.status || 0)
    if ((request.method || '').toUpperCase() === 'POST' && /login|signin|auth/.test(path)) return 'suspicious'
    if (status === 401 || status === 403) return 'suspicious'
    if (/\/admin|\/api\/admin/.test(path)) return 'suspicious'
    if (/union select|or 1=1|<script|\.\./.test(body)) return 'finding'
    return 'normal'
  }

  decodeJwt(request) {
    const candidates = [request.requestHeaders?.authorization || '', request.responseBody || '']
    const token = candidates.map((v) => String(v)).find((v) => v.includes('eyJ'))
    if (!token) return null

    const raw = token.replace(/^Bearer\s+/i, '').trim().split(' ')[0]
    const parts = raw.split('.')
    if (parts.length < 2) return null

    try {
      const parse = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
      return { header: parse(parts[0]), payload: parse(parts[1]), verified: false }
    } catch {
      return null
    }
  }
}

export default RequestCapture
