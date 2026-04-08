import fs from 'fs'
import path from 'path'
import { glob } from 'glob'

class RouteExtractor {
  async extract(repoPath, frameworkInfo) {
    const framework = String(frameworkInfo?.framework || '').toLowerCase()
    if (framework === 'nextjs') return this.extractNext(repoPath)
    if (framework === 'express' || framework === 'nestjs') return this.extractExpress(repoPath)
    if (framework === 'django') return this.extractDjango(repoPath)
    if (framework === 'rails') return this.extractRails(repoPath)
    return []
  }

  async extractNext(repoPath) {
    const result = []
    for (const root of [path.join(repoPath, 'src', 'app'), path.join(repoPath, 'app')]) {
      if (!fs.existsSync(root)) continue
      const files = await glob('**/route.{ts,js}', { cwd: root })
      for (const file of files) {
        const full = path.join(root, file)
        const content = fs.readFileSync(full, 'utf8')
        const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) => content.includes(`function ${m}`))
        const rel = path.relative(repoPath, full).split(path.sep).join('/')
        const routePath = `/${file.replace(/\/route\.(ts|js)$/, '').replace(/\[(.*?)\]/g, ':$1')}`
        for (const method of methods.length ? methods : ['GET']) {
          result.push({
            method,
            path: routePath,
            authRequired: /withAuth|requireAuth|getServerSession|auth/i.test(content),
            sourceFile: rel,
            sourceLine: 1,
            params: Array.from(routePath.matchAll(/:([A-Za-z0-9_]+)/g)).map((m) => m[1]),
            queryParams: [],
            inferred: false
          })
        }
      }
    }
    return result
  }

  async extractExpress(repoPath) {
    const result = []
    const srcRoot = path.join(repoPath, 'src')
    if (!fs.existsSync(srcRoot)) return result
    const files = await glob('**/*.{js,ts}', { cwd: srcRoot })
    const regex = /(router|app)\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g

    for (const file of files) {
      const full = path.join(srcRoot, file)
      const content = fs.readFileSync(full, 'utf8')
      const rel = path.relative(repoPath, full).split(path.sep).join('/')
      let match
      while ((match = regex.exec(content)) !== null) {
        const pathValue = match[3].startsWith('/') ? match[3] : `/${match[3]}`
        result.push({
          method: match[2].toUpperCase(),
          path: pathValue,
          authRequired: /auth|protect|requireLogin|isAuthenticated/i.test(content),
          sourceFile: rel,
          sourceLine: 1,
          params: Array.from(pathValue.matchAll(/:([A-Za-z0-9_]+)/g)).map((m) => m[1]),
          queryParams: [],
          inferred: false
        })
      }
    }
    return result
  }

  async extractDjango(repoPath) {
    const urls = path.join(repoPath, 'urls.py')
    if (!fs.existsSync(urls)) return []
    const content = fs.readFileSync(urls, 'utf8')
    const routes = []
    const regex = /path\(['"]([^'"]+)['"]/g
    let match
    while ((match = regex.exec(content)) !== null) {
      routes.push({
        method: 'GET',
        path: `/${match[1]}`,
        authRequired: /login_required|permission_required|auth/i.test(content),
        sourceFile: 'urls.py',
        sourceLine: 1,
        params: [],
        queryParams: [],
        inferred: false
      })
    }
    return routes
  }

  async extractRails(repoPath) {
    const file = path.join(repoPath, 'config', 'routes.rb')
    if (!fs.existsSync(file)) return []
    const content = fs.readFileSync(file, 'utf8')
    const routes = []
    const regex = /\b(get|post|put|patch|delete)\s+['"]([^'"]+)['"]/g
    let match
    while ((match = regex.exec(content)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: `/${match[2]}`,
        authRequired: /authenticate|authorize|before_action/i.test(content),
        sourceFile: 'config/routes.rb',
        sourceLine: 1,
        params: [],
        queryParams: [],
        inferred: false
      })
    }
    return routes
  }
}

export default RouteExtractor
