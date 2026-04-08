import fs from 'fs/promises'
import path from 'path'

const IGNORED = new Set(['node_modules', '.git', '.next', '__pycache__', 'dist', 'build', '.venv', 'venv'])
const MANIFEST_NAMES = new Set(['package.json', 'pyproject.toml', 'go.mod'])
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.java', '.kt', '.rb', '.php', '.go', '.rs', '.cs',
  '.html', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
  '.sql', '.graphql', '.gql',
  '.md', '.txt',
  '.yml', '.yaml', '.toml', '.ini', '.env', '.sh', '.ps1', '.bat',
])

const IMPORTANT_JSON_FILES = new Set([
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'eslint.config.json',
  '.eslintrc.json',
  '.prettierrc',
  '.prettierrc.json',
  'launch.json',
  'tasks.json',
  'extensions.json',
  'settings.json',
])

function shouldIncludeFile(filePath) {
  const normalized = String(filePath || '').split(path.sep).join('/')
  const name = path.basename(normalized).toLowerCase()
  const ext = path.extname(name).toLowerCase()

  if (IMPORTANT_JSON_FILES.has(name)) {
    return true
  }

  if (name === 'composer.lock' || name === 'package-lock.json' || name === 'pnpm-lock.yaml' || name === 'yarn.lock') {
    return false
  }

  if (ext === '.json') {
    return false
  }

  if (CODE_EXTENSIONS.has(ext)) {
    return true
  }

  return MANIFEST_NAMES.has(name)
}

function annotationFor(filePath) {
  const lower = filePath.toLowerCase()
  if (lower.includes('/api/') || lower.endsWith('route.ts') || lower.endsWith('route.js')) return 'ROUTE'
  if (lower.includes('middleware')) return 'MIDDLEWARE'
  if (lower.includes('next.config') || lower.includes('vite.config') || lower.includes('settings.py')) return 'CONFIG'
  if (lower.includes('/migrations/') || lower.includes('/prisma/migrations/')) return 'MIGRATION'
  if (lower.includes('__tests__') || lower.includes('/spec/') || lower.endsWith('.test.ts') || lower.endsWith('.spec.ts')) return 'TEST'
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) return 'COMPONENT'
  if (lower.endsWith('.ts') || lower.endsWith('.js') || lower.endsWith('.py')) return 'UTIL'
  return null
}

class FolderTreeBuilder {
  async build(repoPath, options = {}) {
    const basePath = path.isAbsolute(repoPath) ? repoPath : path.resolve(process.cwd(), repoPath)
    const routeCountByFile = this.createRouteCountMap(options.routes)
    const packageGroups = await this.detectPackages(basePath)
    const root = await this.walk(basePath, basePath, routeCountByFile, packageGroups)
    return {
      ...root,
      packageGroups,
    }
  }

  createRouteCountMap(routes = []) {
    const map = new Map()
    for (const route of routes || []) {
      const sourceFile = String(route?.sourceFile || '').split(path.sep).join('/')
      if (!sourceFile || sourceFile === 'unresolved' || sourceFile === 'openapi-spec') {
        continue
      }
      map.set(sourceFile, Number(map.get(sourceFile) || 0) + 1)
    }
    return map
  }

  async detectPackages(basePath) {
    const packages = []
    await this.walkPackages(basePath, basePath, packages)
    if (packages.length === 0) {
      return [{ name: path.basename(basePath), root: '.', manifest: '' }]
    }
    return packages.sort((a, b) => a.root.localeCompare(b.root))
  }

  async walkPackages(base, current, out) {
    let entries = []
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }

    const rel = path.relative(base, current).split(path.sep).join('/') || '.'
    const manifest = entries.find((entry) => entry.isFile() && MANIFEST_NAMES.has(entry.name))
    if (manifest) {
      out.push({
        name: rel === '.' ? path.basename(base) : rel,
        root: rel,
        manifest: manifest.name,
      })
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED.has(entry.name)) {
        continue
      }
      await this.walkPackages(base, path.join(current, entry.name), out)
    }
  }

  resolvePackage(relPath, packageGroups = []) {
    const normalized = String(relPath || '').split(path.sep).join('/')
    let winner = packageGroups.find((group) => group.root === '.') || null
    for (const group of packageGroups) {
      if (group.root === '.') {
        continue
      }
      if (normalized === group.root || normalized.startsWith(`${group.root}/`)) {
        if (!winner || group.root.length > winner.root.length) {
          winner = group
        }
      }
    }
    return winner?.name || (packageGroups[0]?.name || 'project')
  }

  async walk(base, current, routeCountByFile, packageGroups) {
    const rel = path.relative(base, current).split(path.sep).join('/')
    const node = {
      name: rel ? path.basename(current) : path.basename(base),
      type: 'directory',
      path: rel,
      annotation: null,
      packageName: this.resolvePackage(rel, packageGroups),
      routeCount: 0,
      children: [],
    }

    let entries = []
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return node
    }

    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (IGNORED.has(entry.name)) {
        continue
      }

      const abs = path.join(current, entry.name)
      const childRel = path.relative(base, abs).split(path.sep).join('/')

      if (entry.isDirectory()) {
        const childDir = await this.walk(base, abs, routeCountByFile, packageGroups)
        if ((childDir.children || []).length === 0 && Number(childDir.routeCount || 0) === 0) {
          continue
        }
        node.routeCount += Number(childDir.routeCount || 0)
        node.children.push(childDir)
        continue
      }

      const routeCount = Number(routeCountByFile.get(childRel) || 0)

      if (!shouldIncludeFile(childRel)) {
        node.routeCount += routeCount
        continue
      }

      node.routeCount += routeCount
      node.children.push({
        name: entry.name,
        type: 'file',
        path: childRel,
        annotation: annotationFor(childRel),
        packageName: this.resolvePackage(childRel, packageGroups),
        routeCount,
        children: [],
      })
    }

    return node
  }
}

export default FolderTreeBuilder
