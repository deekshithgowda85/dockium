import { chromium, firefox, webkit } from 'playwright'
import BrowserSession from './BrowserSession.js'
import LegitUser from './roles/LegitUser.js'
import AttackerUser from './roles/AttackerUser.js'
import AdminMapper from './roles/AdminMapper.js'
import FieldFuzzer from './roles/FieldFuzzer.js'

class BrowserFleet {
  constructor(config, wss = null) {
    this.config = config
    this.wss = wss
    this.browser = null
    this.sessions = new Map()
    this.findings = []
    this.routes = []
    this.launchConfig = {
      browserEngine: 'chromium',
      headless: false,
      windowCount: 6,
      roles: [],
      useProxy: false,
    }
  }

  resolveRoleNames(options = {}) {
    const defaults = ['legitUser', 'admin', 'attacker', 'fieldFuzzer', 'observerOne', 'observerTwo']
    const requested = Array.isArray(options.roles) ? options.roles.filter(Boolean) : []
    const windowCount = Math.max(1, Math.min(12, Number(options.windowCount || this.launchConfig.windowCount || 6)))

    const names = requested.length > 0 ? requested : defaults
    if (names.length >= windowCount) {
      return names.slice(0, windowCount)
    }

    const fallback = [...defaults]
    const merged = [...names]
    for (const role of fallback) {
      if (merged.length >= windowCount) {
        break
      }
      if (!merged.includes(role)) {
        merged.push(role)
      }
    }

    while (merged.length < windowCount) {
      merged.push(`observer${merged.length + 1}`)
    }

    return merged.slice(0, windowCount)
  }

  getBrowserLauncher(engine) {
    const normalized = String(engine || 'chromium').toLowerCase()
    if (normalized === 'firefox') return firefox
    if (normalized === 'webkit') return webkit
    return chromium
  }

  async initialize(routes = [], options = {}) {
    if (this.browser) return
    this.routes = routes

    const browserEngine = String(options.browserEngine || 'chromium').toLowerCase()
    const headless = options.headless === true
    const launcher = this.getBrowserLauncher(browserEngine)

    this.launchConfig = {
      browserEngine,
      headless,
      windowCount: Math.max(1, Math.min(12, Number(options.windowCount || 6))),
      roles: Array.isArray(options.roles) ? options.roles : [],
      useProxy: options.useProxy === true,
    }

    this.browser = await launcher.launch({
      headless,
      args: headless ? [] : ['--window-size=980,720']
    })
    this.wss?.emit('fleet', {
      sessionId: 'fleet',
      role: 'SYSTEM',
      event: 'initialized',
      data: `Initialized ${browserEngine} fleet (${headless ? 'headless' : 'headed'})`
    })
  }

  async launchSession(roleName) {
    if (!this.browser) await this.initialize()
    if (this.sessions.has(roleName)) return this.sessions.get(roleName).page

    const context = await this.browser.newContext({
      proxy: this.launchConfig.useProxy ? { server: 'http://127.0.0.1:8080' } : undefined,
      viewport: { width: 960, height: 640 }
    })
    const page = await context.newPage()
    const session = new BrowserSession({
      sessionId: roleName,
      role: roleName,
      context,
      page,
      wss: this.wss,
      findings: this.findings
    })

    page.on('request', (request) => {
      session.requestCount += 1

      try {
        const parsed = new URL(request.url())
        this.wss?.emit('fleet', {
          sessionId: roleName,
          role: roleName,
          event: 'request',
          data: {
            id: `${roleName}-${Date.now()}-${session.requestCount}`,
            method: String(request.method() || 'GET').toUpperCase(),
            host: parsed.host,
            path: `${parsed.pathname}${parsed.search || ''}`,
            status: '--',
            timeMs: 0,
          }
        })
      } catch {
        // Ignore malformed URL parsing; count is still tracked.
      }

      if (session.requestCount % 10 === 0) {
        this.wss?.emit('fleet', {
          sessionId: roleName,
          role: roleName,
          event: 'request_count',
          data: `Captured ${session.requestCount} requests`
        })
      }
    })

    this.sessions.set(roleName, session)
    session.markStarting()
    this.runRole(roleName, session)
      .then(() => session.markComplete())
      .catch((error) => session.markError(String(error?.message || 'Role workflow failed')))

    return page
  }

  async runObserver(session, startIndex = 0) {
    const target = this.config.project.targetUrl
    if (!Array.isArray(this.routes) || this.routes.length === 0) {
      await session.navigate(target)
      return
    }

    const slice = this.routes.slice(startIndex, startIndex + 20)
    for (const route of slice) {
      const path = String(route.path || '/').replace(/:id/g, '1')
      const url = `${target}${path.startsWith('/') ? path : `/${path}`}`
      await session.navigate(url)
    }

  }

  async runRole(roleName, session) {
    const roles = {
      legitUser: new LegitUser(session, this.config),
      attacker: new AttackerUser(session, this.config),
      admin: new AdminMapper(session, this.config),
      fieldFuzzer: new FieldFuzzer(session, this.config)
    }

    if (roleName === 'observerOne') {
      await this.runObserver(session, 0)
      return
    }

    if (roleName === 'observerTwo') {
      await this.runObserver(session, 20)
      return
    }

    if (/^observer\d+$/i.test(roleName)) {
      const offset = Math.max(0, (Number(roleName.replace(/\D/g, '')) - 1) * 10)
      await this.runObserver(session, offset)
      return
    }

    const roleRunner = roles[roleName]
    if (!roleRunner) {
      await this.runObserver(session, 0)
      return
    }

    if (roleName === 'fieldFuzzer' && session.lastUrl === '--') {
      await session.navigate(this.config.project.targetUrl)
    }

    await roleRunner.run(this.routes)
  }

  async closeSession(roleName) {
    const session = this.sessions.get(roleName)
    if (!session) return
    session.stopLivePreview()
    await session.context.close()
    this.sessions.delete(roleName)
  }

  async closeAll() {
    for (const roleName of [...this.sessions.keys()]) {
      await this.closeSession(roleName)
    }
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
    this.sessions.clear()
  }

  getPage(roleName) {
    return this.sessions.get(roleName)?.page || null
  }

  getStatus(roleName) {
    const session = this.sessions.get(roleName)
    if (!session) return { role: roleName, status: 'IDLE', context: '--' }
    return session.getStatus()
  }

  getStats() {
    return Object.fromEntries([...this.sessions.keys()].map((role) => [role, this.getStatus(role)]))
  }

  getFindings() {
    return this.findings
  }
}

export default BrowserFleet
