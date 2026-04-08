import axios from 'axios'

class ZapBridge {
  constructor(baseUrl = 'http://localhost:8090', apiKey = 'dockium-key') {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
  }

  normalizeError(error, action) {
    const code = String(error?.code || '').toUpperCase()
    const status = Number(error?.response?.status || 0)
    const responseData = error?.response?.data
    const responseText = responseData
      ? (typeof responseData === 'string' ? responseData : JSON.stringify(responseData))
      : ''
    if (code === 'ECONNREFUSED') {
      return new Error(`ZAP container is not reachable at ${this.baseUrl} while ${action}`)
    }
    if (code === 'ENOTFOUND') {
      return new Error(`ZAP host could not be resolved at ${this.baseUrl} while ${action}`)
    }
    if (code === 'ECONNABORTED') {
      return new Error(`ZAP request timed out while ${action}`)
    }
    if (status > 0) {
      return new Error(`ZAP API error while ${action}: HTTP ${status}${responseText ? ` - ${responseText}` : ''}`)
    }
    return new Error(`ZAP API error while ${action}: ${String(error?.message || 'unknown error')}`)
  }

  normalizeTargetUrl(targetUrl) {
    const raw = String(targetUrl || '').trim()
    if (!raw) {
      return ''
    }
    if (/^https?:\/\//i.test(raw)) {
      return raw
    }
    return `http://${raw}`
  }

  async retryWithBackoff(operation, maxRetries = 5, initialDelayMs = 1000) {
    let lastError = null
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        const code = String(error?.code || '').toUpperCase()
        const status = Number(error?.response?.status || 0)
        
        // Retry on connection errors and 5xx server errors
        const shouldRetry = code === 'ECONNREFUSED' 
          || code === 'ECONNRESET' 
          || code === 'ECONNABORTED'
          || code === 'ETIMEDOUT'
          || code === 'SOCKET_HANG_UP'
          || status >= 500
        
        if (!shouldRetry || attempt === maxRetries - 1) {
          throw error
        }

        const delayMs = initialDelayMs * Math.pow(2, attempt)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
    throw lastError
  }

  buildTargetCandidates(targetUrl) {
    const normalized = this.normalizeTargetUrl(targetUrl)
    if (!normalized) {
      return []
    }

    const candidates = [normalized]
    try {
      const parsed = new URL(normalized)
      const host = parsed.hostname.toLowerCase()
      if (host === 'localhost' || host === '127.0.0.1') {
        const hostInternal = new URL(parsed.toString())
        hostInternal.hostname = 'host.docker.internal'
        candidates.push(hostInternal.toString())

        const dockiumApp = new URL(parsed.toString())
        dockiumApp.hostname = 'dockium-app'
        candidates.push(dockiumApp.toString())
      }
    } catch {}

    return [...new Set(candidates)]
  }

  async primeTarget(candidateUrl) {
    try {
      await this.retryWithBackoff(
        () => axios.get(`${this.baseUrl}/JSON/core/action/accessUrl/`, {
          params: { url: candidateUrl, followRedirects: true, apikey: this.apiKey },
          timeout: 15000,
        }),
        3,
        800
      )
    } catch {
      // Priming is best-effort; active scan call below decides final viability
    }
  }

  async startActiveScan(targetUrl) {
    const candidates = this.buildTargetCandidates(targetUrl)
    if (candidates.length === 0) {
      throw new Error('No valid ZAP target URL candidates could be resolved')
    }

    let lastError = null
    const failedCandidates = []

    for (const candidateUrl of candidates) {
      try {
        await this.primeTarget(candidateUrl)
        const response = await this.retryWithBackoff(
          () => axios.get(`${this.baseUrl}/JSON/ascan/action/scan/`, {
            params: {
              url: candidateUrl,
              recurse: true,
              inScopeOnly: false,
              apikey: this.apiKey,
            },
            timeout: 20000,
          }),
          5,
          1500
        )
        return {
          scanId: String(response.data.scan || ''),
          targetUrl: candidateUrl,
        }
      } catch (error) {
        lastError = error
        failedCandidates.push(candidateUrl)
      }
    }

    try {
      throw lastError || new Error('No valid ZAP target URL candidates could be resolved')
    } catch (error) {
      const normalized = this.normalizeError(error, `starting active scan (target: ${targetUrl})`)
      if (failedCandidates.length > 0) {
        normalized.message += ` | candidates tried: ${failedCandidates.join(', ')}`
      }
      throw normalized
    }
  }

  async getScanProgress(scanId) {
    try {
      const response = await this.retryWithBackoff(
        () => axios.get(`${this.baseUrl}/JSON/ascan/view/status/`, {
          params: { scanId, apikey: this.apiKey },
          timeout: 15000,
        }),
        3,
        800
      )
      return Number(response.data.status || 0)
    } catch (error) {
      throw this.normalizeError(error, 'fetching active scan status')
    }
  }

  async getAlerts() {
    try {
      const response = await this.retryWithBackoff(
        () => axios.get(`${this.baseUrl}/JSON/core/view/alerts/`, {
          params: { apikey: this.apiKey },
          timeout: 15000,
        }),
        3,
        800
      )
      return (response.data.alerts || []).map((alert) => ({
        severity: Number(alert.riskcode || 0) >= 3 ? 'critical' : Number(alert.riskcode || 0) >= 2 ? 'high' : 'medium',
        name: alert.name,
        endpoint: alert.url,
        description: alert.description,
        proof: alert.evidence || '',
        fix: alert.solution || ''
      }))
    } catch (error) {
      throw this.normalizeError(error, 'loading alerts')
    }
  }

  async forwardRequest(capturedRequest) {
    try {
      await axios.get(`${this.baseUrl}/JSON/spider/action/scan/`, {
        params: { apikey: this.apiKey, url: `http://${capturedRequest.host}${capturedRequest.path}` },
        timeout: 8000,
      })
    } catch (error) {
      throw this.normalizeError(error, 'forwarding proxy request to spider')
    }
  }
}

export default ZapBridge
