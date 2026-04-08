import { generateDockerfile } from '../docker/generator.js'

export async function generate(repoPath, frameworkInfo) {
  const path = await generateDockerfile(repoPath, frameworkInfo)
  return path
}

export default { generate }
