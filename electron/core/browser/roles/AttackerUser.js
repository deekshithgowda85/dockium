class AttackerUser {
  constructor(session, config) {
    this.session = session
    this.config = config
  }

  isUiRoute(route) {
    const method = String(route?.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      return false
    }

    const pathValue = String(route?.path || '').toLowerCase()
    if (!pathValue || pathValue === '/api' || pathValue === '/rest' || pathValue.startsWith('/api/') || pathValue.startsWith('/rest/')) {
      return false
    }

    return !/\.(json|xml|js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map)$/i.test(pathValue)
  }

  async run(routes = []) {
    const target = this.config.project.targetUrl
    const uiRoutes = Array.isArray(routes) ? routes.filter((route) => this.isUiRoute(route)) : []

    if (uiRoutes.length === 0) {
      await this.session.navigate(target)
      await this.session.navigate(`${target.replace(/\/$/, '')}/admin`)
      this.session.recordFinding({
        severity: 'medium',
        title: 'Attacker baseline probes executed',
        endpoint: '/admin',
        description: 'Route discovery was empty; attacker role executed fallback probes against root and /admin.',
      })
      return
    }

    await this.session.navigate(target)

    for (const route of uiRoutes.slice(0, 30)) {
      const raw = String(route.path || '/')
      const attackPath = raw.includes(':id') ? raw.replace(':id', '2') : raw
      const url = `${target}${attackPath.startsWith('/') ? attackPath : `/${attackPath}`}`
      await this.session.navigate(url)
      if (/admin|user\/:id|users\/:id/i.test(raw)) {
        this.session.recordFinding({
          severity: 'high',
          title: 'Potential IDOR surface observed',
          endpoint: attackPath,
          description: 'Attacker session reached a sensitive route. Verify authorization checks.'
        })
      }
    }
  }
}

export default AttackerUser
