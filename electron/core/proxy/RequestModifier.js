import fetch from 'node-fetch'

class RequestModifier {
  async replay(capturedRequest, modifications = {}) {
    const method = String(modifications.method || capturedRequest.method || 'GET').toUpperCase()
    const host = modifications.host || capturedRequest.host || 'localhost:3000'
    const path = modifications.path || capturedRequest.path || '/'
    const url = `${host.startsWith('http') ? '' : 'http://'}${host}${path}`

    const response = await fetch(url, {
      method,
      headers: modifications.headers || capturedRequest.requestHeaders || {},
      body: modifications.body || capturedRequest.requestBody || undefined
    })

    return {
      method,
      host,
      path,
      requestHeaders: modifications.headers || capturedRequest.requestHeaders || {},
      requestBody: modifications.body || capturedRequest.requestBody || '',
      responseStatus: response.status,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      responseBody: await response.text(),
      durationMs: 0,
      isReplay: true
    }
  }
}

export default RequestModifier
