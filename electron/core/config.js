import fs from 'fs'
import path from 'path'

export function loadConfig(repoPath) {
  const configPath = path.join(repoPath, '.dockium', 'config.json')
  if (!fs.existsSync(configPath)) {
    throw new Error('Dockium config not found. Run: dockium init')
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'))
}

export function saveConfig(repoPath, config) {
  const dockiumDir = path.join(repoPath, '.dockium')
  if (!fs.existsSync(dockiumDir)) {
    fs.mkdirSync(dockiumDir, { recursive: true })
  }
  fs.writeFileSync(
    path.join(dockiumDir, 'config.json'),
    JSON.stringify(config, null, 2)
  )
}

export function loadEnv(repoPath) {
  const envPath = path.join(repoPath, '.dockium', '.env')
  if (!fs.existsSync(envPath)) {
    return {}
  }
  
  const env = {}
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  lines.forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=')
      env[key] = valueParts.join('=')
    }
  })
  return env
}
