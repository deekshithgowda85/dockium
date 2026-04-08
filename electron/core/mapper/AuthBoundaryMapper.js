class AuthBoundaryMapper {
  async map(routes, capturedRequests) {
    return (routes || []).map((route) => {
      const path = String(route?.path || '/')
      const middlewareChain = Array.isArray(route?.middlewareChain) ? route.middlewareChain : []
      const requiredRole = Array.isArray(route?.roles) && route.roles.length > 0
        ? route.roles.join(', ')
        : (/admin/i.test(path) ? 'admin' : (route?.authRequired ? 'user' : 'none'))

      return {
        path,
        requiredRole,
        requiredPermissions: Array.isArray(route?.permissions) ? route.permissions : [],
        enforcedBy: route?.authRequired ? (middlewareChain.join(' -> ') || 'middleware/decorator') : 'public',
        authStatus: route?.authStatus || (route?.authRequired ? 'AUTH REQUIRED' : 'PUBLIC'),
        rateLimit: route?.rateLimit || null,
      }
    })
  }
}

export default AuthBoundaryMapper
