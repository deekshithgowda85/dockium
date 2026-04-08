class AttackerUser {
  constructor(session, config) {
    this.session = session
    this.config = config
  }

  async run(routes = []) {
    const target = this.config.project.targetUrl
    if (!Array.isArray(routes) || routes.length === 0) {
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

    for (const route of routes.slice(0, 25)) {
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
