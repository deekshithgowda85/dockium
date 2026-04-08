import FolderTreeBuilder from '../mapper/FolderTreeBuilder.js'
import RouteExtractor from '../mapper/RouteExtractor.js'
import ApiGraphBuilder from '../mapper/ApiGraphBuilder.js'
import AuthBoundaryMapper from '../mapper/AuthBoundaryMapper.js'

class DiscoveryEngine {
  constructor(config, repoPath) {
    this.config = config
    this.repoPath = repoPath
    this.framework = config.project.framework
    this.routeExtractor = new RouteExtractor()
    this.folderTreeBuilder = new FolderTreeBuilder()
    this.apiGraphBuilder = new ApiGraphBuilder()
    this.authBoundaryMapper = new AuthBoundaryMapper()
  }

  async discoverRoutes(options = {}) {
    const detailed = await this.routeExtractor.extractDetailed(this.repoPath, { framework: this.framework }, options)
    return detailed.routes
  }

  async discoverFileTree(routes = []) {
    return await this.folderTreeBuilder.build(this.repoPath, { routes })
  }

  async discoverApiGraph(capturedRequests = []) {
    return await this.apiGraphBuilder.buildFromTraffic(capturedRequests)
  }

  async discoverApiGraphFromRoutes(routes = []) {
    return await this.apiGraphBuilder.buildFromRoutes(routes)
  }

  async discoverAuthBoundaries(routes = [], capturedRequests = []) {
    return await this.authBoundaryMapper.map(routes, capturedRequests)
  }

  async scanAppMap(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}

    onProgress({ group: 'routes', status: 'loading', message: 'Discovering runtime routes' })
    const routeResult = await this.routeExtractor.extractDetailed(
      this.repoPath,
      { framework: this.framework },
      {
        targetUrl: options.targetUrl,
        token: options.authToken,
        autoAuth: options.autoAuth === true,
        credentials: options.credentials || this.config.credentials || {},
      }
    )

    const packageRoots = Array.isArray(routeResult.packageRoots) ? routeResult.packageRoots : []
    const withPackages = routeResult.routes.map((route) => {
      const source = String(route?.sourceFile || '').replace(/\\/g, '/')
      let winner = packageRoots.find((entry) => entry.root === '.') || null
      for (const pkg of packageRoots) {
        if (pkg.root === '.') {
          continue
        }
        if (source === pkg.root || source.startsWith(`${pkg.root}/`)) {
          if (!winner || String(pkg.root).length > String(winner.root || '').length) {
            winner = pkg
          }
        }
      }

      return {
        ...route,
        packageName: winner?.name || (packageRoots[0]?.name || 'project'),
      }
    })

    onProgress({ group: 'routes', status: 'done', message: `Discovered ${withPackages.length} routes` })
    onProgress({ group: 'tree', status: 'loading', message: 'Building project tree with route links' })
    const folderTree = await this.discoverFileTree(withPackages)
    onProgress({ group: 'tree', status: 'done', message: 'Project tree ready' })

    onProgress({ group: 'api', status: 'loading', message: 'Building API graph and auth boundaries' })
    const [apiGraph, authBoundaries] = await Promise.all([
      this.discoverApiGraphFromRoutes(withPackages),
      this.discoverAuthBoundaries(withPackages, []),
    ])
    onProgress({ group: 'api', status: 'done', message: 'API graph ready' })

    return {
      routeTree: withPackages,
      folderTree,
      apiGraph,
      authBoundaries,
      warnings: routeResult.warnings,
      openApiInfo: routeResult.openApiInfo,
      openApiSummary: routeResult.openApiInfo?.title
        ? `OpenAPI detected: ${routeResult.openApiInfo.title}${routeResult.openApiInfo.version ? ` ${routeResult.openApiInfo.version}` : ''}`
        : '',
      openApiDiagnostics: [],
      authInfo: routeResult.authInfo || this.routeExtractor.getLastAuthInfo(),
      packageGroups: routeResult.packageRoots,
      scannedAt: new Date().toISOString(),
    }
  }

  async testRoute(route, options = {}) {
    if (!route || !options?.targetUrl) {
      return {
        ok: false,
        error: 'Missing route or target URL',
        code: 400,
        detail: 'testRoute requires route metadata and targetUrl',
      }
    }

    const result = await this.routeExtractor.liveProbeRoute(
      route,
      options.targetUrl,
      options.authHeaders || {},
      {
        headers: options.headers || {},
        body: options.body,
        params: options.params || [],
        method: options.method || route?.method,
      }
    )

    return {
      ok: true,
      route: result,
    }
  }
}

export default DiscoveryEngine
