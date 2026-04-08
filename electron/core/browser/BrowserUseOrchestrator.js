class BrowserUseOrchestrator {
  constructor(config, fleet) {
    this.config = config
    this.fleet = fleet
  }

  async runAll() {
    const results = []
    const status = this.fleet?.getStats?.() || {}
    for (const [sessionId, item] of Object.entries(status)) {
      if (item?.status === 'RUNNING') {
        results.push({
          type: 'BrowserUse',
          severity: 'info',
          title: 'Browser role active',
          endpoint: item.context || this.config.project.targetUrl,
          description: `${sessionId} is active for browser-use flow.`
        })
      }
    }
    return results
  }
}

export default BrowserUseOrchestrator
