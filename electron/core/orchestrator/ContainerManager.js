import Docker from 'dockerode'
import fetch from 'node-fetch'
import NetworkManager from './NetworkManager.js'
import HealthMonitor from './HealthMonitor.js'

const docker = new Docker()
const DEFAULT_CONTAINER_NAMES = ['dockium-scanner', 'dockium-zap', 'dockium-proxy', 'dockium-app']
const ZAP_IMAGE_CANDIDATES = ['zaproxy/zap-stable', 'owasp/zap2docker-stable']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isNotFoundError(error) {
  return Number(error?.statusCode) === 404 || /no such container/i.test(String(error?.message || ''))
}

function isConflictError(error) {
  return Number(error?.statusCode) === 409 || /conflict/i.test(String(error?.message || ''))
}

class ContainerManager {
  constructor() {
    this.networkManager = new NetworkManager()
    this.healthMonitor = new HealthMonitor()
    this.networkName = 'dockium-net'
    this.containerNames = [...DEFAULT_CONTAINER_NAMES]
    this.operationLocks = new Map()
  }

  async withOperationLock(key, operation) {
    if (this.operationLocks.has(key)) {
      return this.operationLocks.get(key)
    }

    const promise = (async () => operation())()
      .finally(() => {
        if (this.operationLocks.get(key) === promise) {
          this.operationLocks.delete(key)
        }
      })

    this.operationLocks.set(key, promise)
    return promise
  }

  shouldUseDbContainer(config) {
    return Boolean(config?.project?.useDbContainer)
  }

  shouldStartAppContainer(config) {
    const importedImage = String(config?.project?.importedImage || '').trim()
    if (importedImage) {
      return true
    }

    const projectPath = String(config?.project?.path || '').trim()
    return Boolean(projectPath) && !projectPath.startsWith('docker://')
  }

  buildContainerNames(config) {
    const names = ['dockium-scanner', 'dockium-zap', 'dockium-proxy']
    if (this.shouldStartAppContainer(config)) {
      names.push('dockium-app')
    }
    if (this.shouldUseDbContainer(config)) {
      names.unshift('dockium-db')
    }
    return names
  }

  async startAll(config) {
    return this.withOperationLock('docker:startAll', async () => {
      this.healthMonitor.wss = config?.wss || this.healthMonitor.wss
      this.containerNames = this.buildContainerNames(config)
      this.networkName = await this.networkManager.createNetwork('dockium-net')

      // Boot order prioritizes app availability; ZAP warmup is non-blocking.
      await this.startScanner(config)
      if (this.shouldUseDbContainer(config)) {
        await this.startDb(config)
      }
      await this.startProxy(config)
      if (this.shouldStartAppContainer(config)) {
        await this.startApp(config)
      }

      if (config?.modules?.zap !== false) {
        try {
          await this.startZap(config)
        } catch (error) {
          config?.wss?.emitLog(`ZAP warmup pending: ${String(error?.message || 'startup pending')}`, 'warn')
        }
      }

      this.healthMonitor.start(this.containerNames)

      return { success: true, containers: this.containerNames }
    })
  }

  async ensureNetwork() {
    this.networkName = await this.networkManager.createNetwork('dockium-net')
  }

  async waitForContainerGone(name, retries = 8, delayMs = 150) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        await docker.getContainer(name).inspect()
      } catch (error) {
        if (isNotFoundError(error)) {
          return
        }
      }
      await sleep(delayMs)
    }
  }

  async removeIfExists(name) {
    const existing = docker.getContainer(name)
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        const info = await existing.inspect()
        if (info?.State?.Running) {
          try {
            await existing.stop({ t: 1 })
          } catch (stopError) {
            if (!isNotFoundError(stopError)) {
              throw stopError
            }
          }
        }

        await existing.remove({ force: true, v: true })
        await this.waitForContainerGone(name)
        return
      } catch (error) {
        if (isNotFoundError(error)) {
          return
        }
        if (isConflictError(error) && attempt < 6) {
          await sleep(200 * attempt)
          continue
        }
        throw error
      }
    }
  }

  async ensureImage(image, options = {}) {
    const { wss = null, label = image } = options
    try {
      await docker.getImage(image).inspect()
      return image
    } catch {}

    wss?.emitLog(`Pulling ${label} image (${image})...`)
    const stream = await docker.pull(image)
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    wss?.emitLog(`Pulled ${label} image (${image})`)
    return image
  }

  async resolveZapImage(config) {
    let lastError = null

    for (const image of ZAP_IMAGE_CANDIDATES) {
      try {
        await this.ensureImage(image, { wss: config?.wss, label: 'ZAP' })
        return image
      } catch (error) {
        lastError = error
        config?.wss?.emitLog(`Failed to pull ZAP image ${image}: ${error.message}`, 'warn')
      }
    }

    const detail = String(lastError?.message || 'unknown pull error')
    throw new Error(`Unable to download a ZAP image (${ZAP_IMAGE_CANDIDATES.join(', ')}). ${detail}`)
  }

  async startDb(config) {
    return this.withOperationLock('container:dockium-db', async () => {
      console.log('Starting DB container...')
      const image = config.project.dbType === 'mysql' ? 'mysql:8.0' : 'postgres:15-alpine'
      const env = config.project.dbType === 'mysql'
        ? ['MYSQL_ROOT_PASSWORD=dockium', 'MYSQL_DATABASE=dockium_db']
        : ['POSTGRES_PASSWORD=dockium', 'POSTGRES_DB=dockium_db', 'POSTGRES_USER=dockium']

      await this.ensureImage(image, { wss: config?.wss, label: 'database' })
      await this.removeIfExists('dockium-db')

      const c = await docker.createContainer({
        Image: image,
        name: 'dockium-db',
        Env: env,
        HostConfig: {
          NetworkMode: this.networkName,
          PortBindings: {
            [`${config.project.dbPort}/tcp`]: [{ HostPort: String(config.project.dbPort) }]
          }
        }
      })

      await c.start()
      await this.waitForPort(config.project.dbPort, 'DB')
    })
  }

  async startApp(config) {
    if (String(config?.project?.importedImage || '').trim()) {
      await this.startImportedApp(config)
      return
    }

    return this.withOperationLock('container:dockium-app', async () => {
      console.log('Building app container...')
      const stream = await docker.buildImage(
        { context: config.project.path, src: ['.dockium.Dockerfile', '.'] },
        { dockerfile: '.dockium.Dockerfile', t: 'dockium-app:latest' }
      )

      await new Promise((res, rej) => {
        docker.modem.followProgress(stream, (err) => err ? rej(err) : res())
      })

      await this.removeIfExists('dockium-app')

      const envContent = `
NODE_ENV=development
DOCKIUM_TARGET=http://localhost:${config.project.appPort}
DOCKIUM_PROXY=http://localhost:8080
`.split('\n').filter(Boolean)

      if (this.shouldUseDbContainer(config)) {
        const isMysql = String(config?.project?.dbType || '').toLowerCase() === 'mysql'
        const dbUrl = isMysql
          ? 'mysql://root:dockium@dockium-db:3306/dockium_db'
          : 'postgresql://dockium:dockium@dockium-db:5432/dockium_db'
        envContent.push(`DATABASE_URL=${dbUrl}`)
      } else {
        envContent.push('DOCKIUM_DB_MODE=disabled')
      }

      const c = await docker.createContainer({
        Image: 'dockium-app:latest',
        name: 'dockium-app',
        Env: envContent,
        HostConfig: {
          NetworkMode: this.networkName,
          PortBindings: {
            [`${config.project.appPort}/tcp`]: [{ HostPort: String(config.project.appPort) }]
          }
        }
      })

      await c.start()
      await this.waitForPort(config.project.appPort, 'App')
    })
  }

  async startImportedApp(config) {
    return this.withOperationLock('container:dockium-app', async () => {
      const imageRef = String(config?.project?.importedImage || '').trim()
      if (!imageRef) {
        throw new Error('Missing imported image reference for app container startup')
      }

      console.log(`Starting imported app container from ${imageRef}...`)
      await this.ensureImage(imageRef, { wss: config?.wss, label: 'imported app' })
      await this.removeIfExists('dockium-app')

      let containerPort = `${config?.project?.appPort || 3000}/tcp`
      try {
        const details = await docker.getImage(imageRef).inspect()
        const exposed = Object.keys(details?.Config?.ExposedPorts || {})
        const tcpPort = exposed.find((item) => /\/tcp$/i.test(item))
        containerPort = tcpPort || exposed[0] || containerPort
      } catch {}

      const c = await docker.createContainer({
        Image: imageRef,
        name: 'dockium-app',
        HostConfig: {
          NetworkMode: this.networkName,
          PortBindings: {
            [containerPort]: [{ HostPort: String(config?.project?.appPort || 3000) }]
          }
        }
      })

      await c.start()
      await this.waitForPort(config?.project?.appPort || 3000, 'App', 60, 2000)
      config?.wss?.emitLog(`Imported app container is running (${imageRef}) on localhost:${config?.project?.appPort || 3000}`)
    })
  }

  async startZap(config) {
    return this.withOperationLock('container:dockium-zap', async () => {
      console.log('Starting OWASP ZAP container...')
      const zapImage = await this.resolveZapImage(config)
      await this.removeIfExists('dockium-zap')

      const c = await docker.createContainer({
        Image: zapImage,
        name: 'dockium-zap',
        Cmd: [
          'zap.sh', '-daemon', '-port', '8090', '-host', '0.0.0.0',
          '-config', 'api.key=dockium-key',
          '-config', 'api.addrs.addr.name=.*',
          '-config', 'api.addrs.addr.regex=true'
        ],
        HostConfig: {
          NetworkMode: this.networkName,
          PortBindings: { '8090/tcp': [{ HostPort: '8090' }] }
        }
      })

      await c.start()
      await this.waitForPort(8090, 'ZAP', 90, 2000)
    })
  }

  async startScanner(config) {
    return this.withOperationLock('container:dockium-scanner', async () => {
      console.log('Starting scanner container...')
      await this.ensureImage('node:18-alpine', { wss: config?.wss, label: 'scanner' })
      try {
        await docker.getImage('node:18-alpine').tag({ repo: 'dockium/scanner', tag: 'latest' })
      } catch {}
      await this.removeIfExists('dockium-scanner')

      const appPort = config?.project?.appPort || 3000
      const configuredTarget = String(config?.project?.targetUrl || '').trim()
      const targetUrl = configuredTarget.includes('localhost') || configuredTarget.includes('127.0.0.1')
        ? `http://dockium-app:${appPort}`
        : (configuredTarget || `http://dockium-app:${appPort}`)

      const c = await docker.createContainer({
        Image: 'dockium/scanner:latest',
        name: 'dockium-scanner',
        Cmd: ['node', '-e', 'setInterval(()=>{},1000)'],
        Env: [
          `DOCKIUM_TARGET=${targetUrl}`,
          'DOCKIUM_ZAP=http://dockium-zap:8090',
        ],
        HostConfig: {
          NetworkMode: this.networkName,
        }
      })

      await c.start()
    })
  }

  async ensureZapRunning(config) {
    this.healthMonitor.wss = config?.wss || this.healthMonitor.wss
    await this.ensureNetwork()

    try {
      const container = docker.getContainer('dockium-zap')
      const info = await container.inspect()
      if (info?.State?.Running) {
        return
      }
    } catch {
      // Continue to start a fresh container when it does not exist.
    }

    await this.startZap(config)
  }

  async ensureScannerRunning(config) {
    this.healthMonitor.wss = config?.wss || this.healthMonitor.wss
    await this.ensureNetwork()

    try {
      const container = docker.getContainer('dockium-scanner')
      const info = await container.inspect()
      if (info?.State?.Running) {
        return
      }
    } catch {
      // Continue to start a fresh container when it does not exist.
    }

    await this.startScanner(config)
  }

  async ensureAppRunning(config) {
    this.healthMonitor.wss = config?.wss || this.healthMonitor.wss
    await this.ensureNetwork()

    if (!this.shouldStartAppContainer(config)) {
      return
    }

    try {
      const container = docker.getContainer('dockium-app')
      const info = await container.inspect()
      if (info?.State?.Running) {
        try {
          await this.waitForPort(config?.project?.appPort || 3000, 'App', 4, 500)
          return
        } catch {
          await this.removeIfExists('dockium-app')
        }
      }
    } catch {
      // Continue to start a fresh app container when it does not exist.
    }

    await this.startApp(config)
  }

  async startProxy(config) {
    return this.withOperationLock('container:dockium-proxy', async () => {
      await this.ensureImage('node:18-alpine', { wss: config?.wss, label: 'proxy' })
      try {
        await docker.getImage('node:18-alpine').tag({ repo: 'dockium/proxy', tag: 'latest' })
      } catch {}
      await this.removeIfExists('dockium-proxy')

      const c = await docker.createContainer({
        Image: 'dockium/proxy:latest',
        name: 'dockium-proxy',
        Cmd: ['node', '-e', 'setInterval(()=>{},1000)'],
        HostConfig: {
          NetworkMode: this.networkName,
        }
      })

      await c.start()
    })
  }

  async waitForPort(port, name, retries = 30, delay = 2000) {
    for (let i = 0; i < retries; i++) {
      try {
        const r = await fetch(`http://localhost:${port}/`, {
          signal: AbortSignal.timeout(1000)
        })
        if (r.status < 600) {
          console.log(`${name} healthy on :${port}`)
          return
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, delay))
    }
    throw new Error(`${name} did not become available on port ${port}`)
  }

  async stopAll() {
    return this.withOperationLock('docker:stopAll', async () => {
      this.healthMonitor.stop()
      const names = this.containerNames.length > 0
        ? this.containerNames
        : ['dockium-db', ...DEFAULT_CONTAINER_NAMES]

      for (const name of names) {
        try {
          const c = docker.getContainer(name)
          await c.stop()
          await c.remove()
        } catch (_) {}
      }
      await this.networkManager.removeNetwork(this.networkName)
      console.log('All containers stopped.')
    })
  }

  async getStatus() {
    const stats = await this.getStats()
    return stats.map((item) => ({
      name: item.name,
      status: item.status,
      ports: item.ports || [],
      cpuPercent: item.cpu,
      memMB: item.memMB,
      health: item.status === 'running' ? 'healthy' : 'stopped'
    }))
  }

  async importContainerByUrl(url) {
    const normalized = String(url || '').trim().replace(/^docker:\/\//i, '')
    if (!normalized) {
      throw new Error('Missing docker image URL')
    }

    await this.ensureImage(normalized)
    const details = await docker.getImage(normalized).inspect()

    return {
      image: normalized,
      id: details?.Id || '',
      size: details?.Size || 0,
      tags: details?.RepoTags || [],
    }
  }

  async restartContainer(name) {
    const c = docker.getContainer(name)
    await c.restart()
    return { success: true, name }
  }

  async execInContainer(name, command) {
    const container = docker.getContainer(name)
    const exec = await container.exec({
      Cmd: Array.isArray(command) ? command : ['sh', '-lc', String(command)],
      AttachStdout: true,
      AttachStderr: true
    })

    const stream = await exec.start({})
    const chunks = []
    await new Promise((resolve) => {
      stream.on('data', (data) => chunks.push(data))
      stream.on('end', resolve)
    })

    return { output: Buffer.concat(chunks).toString('utf8') }
  }

  async getStats() {
    const names = this.containerNames
    const results = []

    for (const name of names) {
      try {
        const c = docker.getContainer(name)
        const info = await c.inspect()
        const stats = await c.stats({ stream: false })
        const cpuD = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats?.cpu_usage?.total_usage || 0)
        const sysD = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats?.system_cpu_usage || 0)
        const cpu = sysD > 0 ? ((cpuD / sysD) * (stats.cpu_stats.online_cpus || 1) * 100).toFixed(1) : 0
        const mem = Math.round(stats.memory_stats.usage / 1024 / 1024)

        results.push({
          name,
          status: info.State.Status,
          ports: Object.keys(info.NetworkSettings?.Ports || {}),
          cpu: parseFloat(cpu),
          memMB: mem
        })
      } catch (_) {
        results.push({ name, status: 'stopped', cpu: 0, memMB: 0 })
      }
    }

    return results
  }
}

export default new ContainerManager()
