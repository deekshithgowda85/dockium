class LegitUser {
  constructor(session, config) {
    this.session = session
    this.config = config
  }

  async run(routes = []) {
    const target = this.config.project.targetUrl
    if (!routes.length) {
      await this.session.navigate(target)
      return
    }

    for (const route of routes.slice(0, 25)) {
      const path = String(route.path || '/').replace(/:id/g, '1')
      await this.session.navigate(`${target}${path.startsWith('/') ? path : `/${path}`}`)
    }
  }
}

export default LegitUser
