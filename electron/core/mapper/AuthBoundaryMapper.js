class AuthBoundaryMapper {
  async map(routes, capturedRequests) {
    const mapped = []
    for (const route of routes || []) {
      const routePath = route.path || '/'
      const enforcedBy = route.authRequired ? 'middleware' : 'unprotected'
      const requiredRole = /admin/i.test(routePath) ? 'admin' : (route.authRequired ? 'user' : 'none')
      mapped.push({ path: routePath, requiredRole, enforcedBy })
    }
    return mapped
  }
}

export default AuthBoundaryMapper
