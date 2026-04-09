import fs from 'fs'
import path from 'path'
import readline from 'readline'
import GitHookInstaller from '../../electron/core/git/GitHookInstaller.js'

function ask(rl, question, fallback = '') {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      const value = String(answer || '').trim()
      resolve(value || fallback)
    })
  })
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function ensureLocalExcludeRules(repoPath) {
  const excludePath = path.join(repoPath, '.git', 'info', 'exclude')
  const patterns = [
    '.dockium/reports/',
    'dockium-report-*.docx',
    'dockium-report-*.pdf',
    'dockium-report-*.md',
    'dockium-report-*.json',
  ]

  let existing = ''
  try {
    if (fs.existsSync(excludePath)) {
      existing = String(fs.readFileSync(excludePath, 'utf8') || '')
    }
  } catch {
    existing = ''
  }

  const missing = patterns.filter((pattern) => !existing.includes(pattern))
  if (missing.length === 0) {
    return
  }

  const suffix = existing.endsWith('\n') || existing.length === 0 ? '' : '\n'
  const block = `${suffix}# Dockium local report artifacts\n${missing.join('\n')}\n`
  fs.appendFileSync(excludePath, block, 'utf8')
}

async function init() {
  const repoPath = process.cwd()
  const defaultName = path.basename(repoPath)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    const name = await ask(rl, `Project name (${defaultName}): `, defaultName)
    const targetUrl = await ask(rl, 'Target URL (http://localhost:3000): ', 'http://localhost:3000')
    const appPortRaw = await ask(rl, 'App port (3000): ', '3000')
    const testCommand = await ask(rl, 'Test command (npm test): ', 'npm test')

    const parsedPort = Number(appPortRaw)
    const appPort = Number.isFinite(parsedPort) && parsedPort > 0 ? Math.floor(parsedPort) : 3000

    const dockiumDir = path.join(repoPath, '.dockium')
    ensureDir(dockiumDir)

    const configPath = path.join(dockiumDir, 'config.json')
    const config = {
      project: {
        name,
        path: repoPath,
        targetUrl,
        appPort,
        testCommand,
      },
      gitGate: {
        enabled: true,
        blockOn: ['critical', 'high'],
        blockOnTestFailure: true,
        blockOnSecrets: true,
      },
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')

    const installer = new GitHookInstaller()
    await installer.install(repoPath)
    ensureLocalExcludeRules(repoPath)

    console.log('[DOCKIUM] Initialization complete')
    console.log(`[DOCKIUM] Config written: ${configPath}`)
    console.log(`[DOCKIUM] Hook installed: ${path.join(repoPath, '.git', 'hooks', 'pre-push')}`)
    console.log(`[DOCKIUM] Local exclude rules updated: ${path.join(repoPath, '.git', 'info', 'exclude')}`)
  } finally {
    rl.close()
  }
}

export default init
