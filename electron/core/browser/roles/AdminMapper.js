class AdminMapper {
  constructor(session, config) {
    this.session = session
    this.config = config
    this.adminRoutes = []
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
    const candidates = routes.filter((route) => this.isUiRoute(route) && /admin/i.test(route.path || ''))

    if (candidates.length === 0) {
      await this.session.navigate(target)
      await this.session.navigate(`${target.replace(/\/$/, '')}/admin`)
      this.session.log('No admin routes discovered from route map; executed fallback admin probes')
      return this.adminRoutes
    }

    for (const route of candidates.slice(0, 20)) {
      const path = String(route.path || '/').replace(/:id/g, '1')
      const url = `${target}${path.startsWith('/') ? path : `/${path}`}`
      await this.session.navigate(url)
      this.adminRoutes.push(path)
    }

    this.session.log(`Mapped ${this.adminRoutes.length} admin surfaces`)
    return this.adminRoutes
  }
}

export default AdminMapper
