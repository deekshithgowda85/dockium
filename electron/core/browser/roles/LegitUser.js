class LegitUser {
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
    if (!uiRoutes.length) {
      await this.session.navigate(target)
      return
    }

    await this.session.navigate(target)

    for (const route of uiRoutes.slice(0, 30)) {
      const path = String(route.path || '/').replace(/:id/g, '1')
      await this.session.navigate(`${target}${path.startsWith('/') ? path : `/${path}`}`)
    }
  }
}

export default LegitUser
