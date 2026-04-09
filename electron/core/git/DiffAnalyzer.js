import simpleGit from 'simple-git'
import RouteExtractor from '../mapper/RouteExtractor.js'

class DiffAnalyzer {
  async analyze(repoPath, pushRef = 'HEAD~1') {
    const git = simpleGit(repoPath)
    let diffString = ''
    let changedFiles = []
    let newRoutes = []
    let commitSha = 'unknown'
    let commitMessage = 'unknown'

    try {
      diffString = await git.diff([`${pushRef}..HEAD`, '--'])
    } catch {
      diffString = ''
    }

    try {
      const changedRaw = await git.diff(['--name-only', `${pushRef}..HEAD`, '--'])
      changedFiles = String(changedRaw)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    } catch {
      changedFiles = []
    }

    let frameworkInfo = { framework: 'express' }
    try {
      const status = await git.status()
      frameworkInfo = { framework: status.current?.includes('next') ? 'nextjs' : 'express' }
    } catch {}

    try {
      const extractor = new RouteExtractor()
      const allRoutes = await extractor.extract(repoPath, frameworkInfo)
      newRoutes = allRoutes.filter((route) => {
        const source = String(route.sourceFile || '').replace(/\\/g, '/')
        return changedFiles.some((file) => source.includes(String(file || '').replace(/\\/g, '/')))
      })
    } catch {
      newRoutes = []
    }

    try {
      const shaRaw = await git.revparse(['HEAD'])
      commitSha = String(shaRaw || '').trim().slice(0, 7) || 'unknown'
    } catch {
      commitSha = 'unknown'
    }

    try {
      commitMessage = String(await git.show(['-s', '--format=%s', 'HEAD']) || '').trim() || 'unknown'
    } catch {
      commitMessage = 'unknown'
    }

    return { changedFiles, newRoutes, removedRoutes: [], diffString, commitSha, commitMessage }
  }
}

export default DiffAnalyzer
