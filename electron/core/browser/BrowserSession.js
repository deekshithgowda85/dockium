class BrowserSession {
  constructor({ sessionId, role, context, page, wss, findings }) {
    this.sessionId = sessionId
    this.role = role
    this.context = context
    this.page = page
    this.wss = wss
    this.findings = findings
    this.status = 'IDLE'
    this.lastUrl = '--'
    this.lastEvent = 'Idle'
    this.requestCount = 0
    this.findingsCount = 0
    this.lastScreenshot = ''
    this.previewInterval = null
    this.previewBusy = false
  }

  startLivePreview() {
    if (this.previewInterval) {
      return
    }

    this.previewInterval = setInterval(async () => {
      if (this.previewBusy || this.status === 'ERROR') {
        return
      }
      this.previewBusy = true
      try {
        await this.captureScreenshot('live')
      } finally {
        this.previewBusy = false
      }
    }, 1400)
  }

  stopLivePreview() {
    if (this.previewInterval) {
      clearInterval(this.previewInterval)
      this.previewInterval = null
    }
  }

  markStarting() {
    this.status = 'STARTING'
    this.lastEvent = 'Starting role workflow'
    this.startLivePreview()
    this.wss?.emit('fleet', {
      sessionId: this.sessionId,
      role: this.role,
      event: 'starting',
      data: this.lastEvent
    })
  }

  markComplete() {
    this.status = 'COMPLETE'
    this.lastEvent = 'Role workflow complete'
    this.stopLivePreview()
    this.wss?.emit('fleet', {
      sessionId: this.sessionId,
      role: this.role,
      event: 'complete',
      data: this.lastEvent
    })
  }

  markError(message) {
    this.status = 'ERROR'
    this.lastEvent = message
    this.stopLivePreview()
    this.wss?.emit('fleet', {
      sessionId: this.sessionId,
      role: this.role,
      event: 'error',
      data: message
    })
  }

  async navigate(url) {
    this.status = 'RUNNING'
    this.lastUrl = url
    this.lastEvent = `Navigating ${url}`
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
      await this.captureScreenshot('navigate')
      this.log(`Navigated ${url}`)
    } catch (error) {
      await this.captureScreenshot('navigation-error')
      this.log(`Navigation error: ${error.message}`)
    }
  }

  async findForms() {
    return await this.page.$$eval('form', (forms) => forms.map((form, index) => ({
      id: `form-${index + 1}`,
      action: form.getAttribute('action') || '',
      method: (form.getAttribute('method') || 'get').toLowerCase(),
      inputCount: form.querySelectorAll('input,textarea,select').length
    })))
  }

  log(message) {
    this.lastEvent = message
    this.wss?.emit('fleet', { sessionId: this.sessionId, role: this.role, event: 'log', data: message })
  }

  async captureScreenshot(reason) {
    try {
      if (!this.page || this.page.isClosed()) {
        return null
      }

      const imageBuffer = await this.page.screenshot({
        type: 'jpeg',
        quality: 58,
        fullPage: false,
        animations: 'disabled'
      })

      this.lastScreenshot = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
      this.wss?.emit('fleet', {
        sessionId: this.sessionId,
        role: this.role,
        event: 'screenshot',
        data: this.lastScreenshot
      })
      return this.lastScreenshot
    } catch {
      return null
    }
  }

  recordFinding(finding) {
    this.findingsCount += 1
    this.findings.push({ ...finding, sessionId: this.sessionId, role: this.role })
    this.wss?.emit('finding', { finding, scanPhase: 'browser-fleet' })
  }

  getStatus() {
    return {
      role: this.role,
      status: this.status,
      context: this.lastUrl || '--',
      requestCount: this.requestCount,
      findingsCount: this.findingsCount,
      lastEvent: this.lastEvent,
      screenshot: this.lastScreenshot,
    }
  }
}

export default BrowserSession
