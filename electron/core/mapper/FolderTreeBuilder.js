import fs from 'fs'
import path from 'path'

const IGNORED = new Set(['node_modules', '.git', '.next', '__pycache__', 'dist', 'build'])

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
  async build(repoPath) {
    const nodes = []
    this.walk(repoPath, repoPath, 0, nodes)
    return nodes
  }

  walk(base, current, depth, out) {
    for (const name of fs.readdirSync(current)) {
      if (IGNORED.has(name)) continue
      const full = path.join(current, name)
      const rel = path.relative(base, full).split(path.sep).join('/')
      const stat = fs.statSync(full)
      const type = stat.isDirectory() ? 'directory' : 'file'
      out.push({ path: rel, type, annotation: type === 'file' ? annotationFor(rel) : null, depth })
      if (stat.isDirectory()) this.walk(base, full, depth + 1, out)
    }
  }
}

export default FolderTreeBuilder
