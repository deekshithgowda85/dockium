import axios from 'axios'

class ZapIntegration {
  constructor(config) {
    this.config = config
    this.zapUrl = 'http://localhost:8090'
    this.apiKey = 'dockium-key'
    this.targetUrl = config.project.targetUrl
  }

  async start() {
    console.log('[ZapIntegration] Starting ZAP integration')
    try {
      const response = await axios.get(`${this.zapUrl}/json/core/action/version`)
      console.log('[ZapIntegration] ZAP version:', response.data.version)
      return true
    } catch (e) {
      console.error('[ZapIntegration] Failed to connect to ZAP:', e.message)
      return false
    }
  }

  async scan(targetUrl = null) {
    const url = targetUrl || this.targetUrl
    console.log(`[ZapIntegration] Starting ZAP scan on ${url}`)

    try {
      // Start spider scan
      const spiderResponse = await axios.get(
        `${this.zapUrl}/json/spider/action/scan`,
        {
          params: {
            apikey: this.apiKey,
            url: url
          }
        }
      )

      const scanId = spiderResponse.data.scan

      // Wait for spider to finish
      await this.waitForScan(scanId)

      // Start active scan
      const activeScanResponse = await axios.get(
        `${this.zapUrl}/json/ascan/action/scan`,
        {
          params: {
            apikey: this.apiKey,
            url: url
          }
        }
      )

      const activeScanId = activeScanResponse.data.scan

      // Wait for active scan to finish
      await this.waitForActiveScan(activeScanId)

      // Get results
      const findings = await this.getFindings()
      return findings
    } catch (e) {
      console.error('[ZapIntegration] Error during scan:', e.message)
      return []
    }
  }

  async waitForScan(scanId, maxWait = 300000) {
    const startTime = Date.now()
    while (Date.now() - startTime < maxWait) {
      try {
        const response = await axios.get(
          `${this.zapUrl}/json/spider/view/status`,
          { params: { apikey: this.apiKey } }
        )

        if (response.data.status === '100') {
          console.log('[ZapIntegration] Spider scan complete')
          return true
        }

        await new Promise(r => setTimeout(r, 5000))
      } catch (e) {
        console.error('[ZapIntegration] Error checking scan status:', e.message)
      }
    }

    throw new Error('Spider scan timed out')
  }

  async waitForActiveScan(scanId, maxWait = 600000) {
    const startTime = Date.now()
    while (Date.now() - startTime < maxWait) {
      try {
        const response = await axios.get(
          `${this.zapUrl}/json/ascan/view/status`,
          { params: { apikey: this.apiKey } }
        )

        if (response.data.status === '100') {
          console.log('[ZapIntegration] Active scan complete')
          return true
        }

        await new Promise(r => setTimeout(r, 10000))
      } catch (e) {
        console.error('[ZapIntegration] Error checking active scan status:', e.message)
      }
    }

    throw new Error('Active scan timed out')
  }

  async getFindings() {
    try {
      const response = await axios.get(
        `${this.zapUrl}/json/core/view/alerts`,
        { params: { apikey: this.apiKey } }
      )

      const findings = []
      if (response.data.alerts) {
        response.data.alerts.forEach(alert => {
          findings.push({
            type: 'ZAP',
            title: alert.name,
            severity: this.mapSeverity(alert.riskcode),
            description: alert.description,
            url: alert.url,
            reference: alert.reference,
            solution: alert.solution
          })
        })
      }

      return findings
    } catch (e) {
      console.error('[ZapIntegration] Error getting findings:', e.message)
      return []
    }
  }

  mapSeverity(riskcode) {
    const map = {
      '3': 'critical',
      '2': 'high',
      '1': 'medium',
      '0': 'low'
    }
    return map[riskcode] || 'medium'
  }
}

export default ZapIntegration
