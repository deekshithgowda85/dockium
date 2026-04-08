import simpleGit from 'simple-git'
import RouteExtractor from '../mapper/RouteExtractor.js'

class DiffAnalyzer {
  async analyze(repoPath, pushRef = 'HEAD~1') {
    const git = simpleGit(repoPath)
    const diffString = await git.diff([`${pushRef}..HEAD`, '--'])
    const changedRaw = await git.diff(['--name-only', `${pushRef}..HEAD`, '--'])
    const changedFiles = changedRaw.split('\n').map((line) => line.trim()).filter(Boolean)

    let frameworkInfo = { framework: 'express' }
    try {
      const status = await git.status()
      frameworkInfo = { framework: status.current?.includes('next') ? 'nextjs' : 'express' }
    } catch {}

    const extractor = new RouteExtractor()
    const allRoutes = await extractor.extract(repoPath, frameworkInfo)
    const newRoutes = allRoutes.filter((route) => changedFiles.some((file) => route.sourceFile?.includes(file)))

    const commitSha = (await git.revparse(['HEAD'])).trim()
    const commitMessage = (await git.show(['-s', '--format=%s', 'HEAD'])).trim()

    return { changedFiles, newRoutes, removedRoutes: [], diffString, commitSha, commitMessage }
  }
}

export default DiffAnalyzer
