import FolderTreeBuilder from '../mapper/FolderTreeBuilder.js'
import RouteExtractor from '../mapper/RouteExtractor.js'
import ApiGraphBuilder from '../mapper/ApiGraphBuilder.js'
import AuthBoundaryMapper from '../mapper/AuthBoundaryMapper.js'
import path from 'path'

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

  async discoverRoutes() {
    return await this.routeExtractor.extract(this.repoPath, { framework: this.framework })
  }

  async discoverFileTree() {
    const flat = await this.folderTreeBuilder.build(this.repoPath)
    const root = { name: path.basename(this.repoPath), type: 'directory', children: [] }
    const map = new Map([['', root]])

    const sorted = [...flat].sort((a, b) => a.depth - b.depth)
    for (const node of sorted) {
      const parts = String(node.path || '').split('/').filter(Boolean)
      const parentKey = parts.slice(0, -1).join('/')
      const parent = map.get(parentKey) || root
      const entry = {
        name: node.type === 'directory' ? `${parts[parts.length - 1]}/` : parts[parts.length - 1],
        type: node.type,
        path: node.path,
        annotation: node.annotation,
        children: []
      }
      parent.children.push(entry)
      if (node.type === 'directory') map.set(node.path, entry)
    }

    return root
  }

  async discoverApiGraph(capturedRequests = []) {
    return await this.apiGraphBuilder.buildFromTraffic(capturedRequests)
  }

  async discoverAuthBoundaries(routes = [], capturedRequests = []) {
    return await this.authBoundaryMapper.map(routes, capturedRequests)
  }
}

export default DiscoveryEngine
