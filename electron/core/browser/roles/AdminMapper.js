class AdminMapper {
  constructor(session, config) {
    this.session = session
    this.config = config
    this.adminRoutes = []
  }

  async run(routes = []) {
    const target = this.config.project.targetUrl
    const candidates = routes.filter((route) => /admin/i.test(route.path || ''))

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
