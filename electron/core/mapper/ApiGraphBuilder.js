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
}

export default ApiGraphBuilder
