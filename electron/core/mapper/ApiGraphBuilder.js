function inferSchema(values) {
  const schema = {}
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    for (const [key, v] of Object.entries(value)) {
      const type = Array.isArray(v) ? 'array' : typeof v
      schema[key] = schema[key] || { type, seen: 0 }
      schema[key].seen += 1
    }
  }
  return Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, { type: v.type }]))
}

function normalizeSchema(value) {
  if (!value) {
    return {}
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return { raw: value }
    }
  }

  if (typeof value === 'object') {
    return value
  }

  return {}
}

class ApiGraphBuilder {
  async buildFromTraffic(capturedRequests) {
    const grouped = new Map()
    for (const req of capturedRequests || []) {
      const key = `${req.method || 'GET'} ${req.path || '/'}`
      const current = grouped.get(key) || []
      current.push(req)
      grouped.set(key, current)
    }

    const graph = []
    for (const [route, list] of grouped.entries()) {
      const requestBodies = list.map((r) => {
        try { return JSON.parse(r.requestBody || '{}') } catch { return {} }
      })
      const responseBodies = list.map((r) => {
        try { return JSON.parse(r.responseBody || '{}') } catch { return {} }
      })

      graph.push({
        route,
        requestSchema: inferSchema(requestBodies),
        responseSchema: inferSchema(responseBodies),
        callChain: [route, 'service-layer', 'data-store', 'response']
      })
    }

    return graph
  }

  async buildFromRoutes(routes = []) {
    return (routes || []).map((route, index) => {
      const method = String(route?.method || 'GET').toUpperCase()
      const path = String(route?.path || '/')
      const requestSchema = normalizeSchema(route?.request?.bodySchema)
      const responseSchema = normalizeSchema(route?.response?.bodySchema)
      const middleware = Array.isArray(route?.middlewareChain) ? route.middlewareChain : []

      return {
        id: route?.id || `flow-${index + 1}`,
        route: `${method} ${path}`,
        method,
        path,
        requestSchema,
        responseSchema,
        callChain: [
          `${method} ${path}`,
          ...middleware.map((entry) => `middleware:${entry}`),
          `handler:${route?.handlerName || 'unknown'}`,
          `source:${route?.sourceFile || 'unresolved'}:${route?.sourceLine || 1}`,
        ],
      }
    })
  }
}

export default ApiGraphBuilder
