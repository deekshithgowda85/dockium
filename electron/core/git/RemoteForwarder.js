import simpleGit from 'simple-git'

class RemoteForwarder {
  async forward(repoPath, remoteUrl, ref) {
    const git = simpleGit(repoPath)
    const remote = remoteUrl || 'origin'
    const branch = ref || (await git.branch()).current
    await git.push(remote, branch)
    return { success: true, output: `Pushed ${branch} to ${remote}` }
  }
}

export default RemoteForwarder
