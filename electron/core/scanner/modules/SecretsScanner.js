import fs from 'fs'
import path from 'path'
import { glob } from 'glob'

class SecretsScanner {
  constructor(config) {
    this.config = config
    this.patterns = {
      apiKey: /['\"]?(api[_-]?key|apikey)['\"]?\s*[:=]\s*['\"]?([a-zA-Z0-9_\-]{20,})['\"]?/gi,
      awsKey: /AKIA[0-9A-Z]{16}/g,
      jwtToken: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      privateKey: /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g,
      databaseUrl: /(?:mysql|postgresql|mongodb):\/\/[^@\s]+@[^\s]+/gi,
      password: /['\"]?(password|passwd)['\"]?\s*[:=]\s*['\"]?([^\s'\"<>]{8,})['\"]?/gi,
      slackToken: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9_-]+/g,
      githubToken: /ghp_[a-zA-Z0-9_]{36,255}/g
    }
  }

  async scan(filePath) {
    console.log(`[SecretsScanner] Scanning for secrets in ${filePath}`)
    const findings = []

    try {
      if (this.isTextFile(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8')
        const matches = this.findSecrets(content, filePath)
        findings.push(...matches)
      }
    } catch (e) {
      console.error(`[SecretsScanner] Error scanning file:`, e.message)
    }

    return findings
  }

  async scanRepo(repoPath) {
    const findings = []
    const files = await glob('**/*', {
      cwd: repoPath,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
    })

    for (const file of files) {
      const fullPath = path.join(repoPath, file)
      const fileFindings = await this.scan(fullPath)
      findings.push(...fileFindings)
    }

    return findings
  }

  async scanDiff(diffContent) {
    console.log('[SecretsScanner] Scanning git diff for secrets')
    const findings = []
    const matches = this.findSecrets(diffContent, 'git-diff')

    return matches
  }

  findSecrets(content, fileName) {
    const findings = []
    const lines = content.split('\n')

    Object.entries(this.patterns).forEach(([type, pattern]) => {
      lines.forEach((line, lineNum) => {
        const safePattern = new RegExp(pattern.source, pattern.flags)
        const matches = [...line.matchAll(safePattern)]
        matches.forEach(match => {
          findings.push({
            type: 'Secrets',
            severity: 'critical',
            title: `${type} detected`,
            description: `Potential ${type} found in ${fileName}`,
            file: fileName,
            line: lineNum + 1,
            column: match.index + 1,
            evidence: match[0].substring(0, 50) + '...'
          })
        })
      })
    })

    return findings
  }

  isTextFile(filePath) {
    const binaryExtensions = ['.bin', '.exe', '.jar', '.zip', '.tar', '.gz', '.png', '.jpg', '.gif']
    const ext = path.extname(filePath).toLowerCase()
    return !binaryExtensions.includes(ext)
  }
}

export default SecretsScanner
