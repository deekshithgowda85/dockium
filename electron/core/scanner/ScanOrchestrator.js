import ApiScanner from './modules/ApiScanner.js'
import AuthScanner from './modules/AuthScanner.js'
import InputScanner from './modules/InputScanner.js'
import SecretsScanner from './modules/SecretsScanner.js'
import CveScanner from './modules/CveScanner.js'
import InfraScanner from './modules/InfraScanner.js'
import DbScanner from './modules/DbScanner.js'
import ArtemisScanner from './modules/ArtemisScanner.js'
import DiscoveryEngine from './DiscoveryEngine.js'
import BrowserUseOrchestrator from '../browser/BrowserUseOrchestrator.js'

class ScanOrchestrator {
  constructor(config) {
    this.config = config
    this.discovery = new DiscoveryEngine(config, config.project.path)
    this.routeCache = null
    this.scannerRouteCache = null
  }

  async run(scanMode = 'full', modules = null) {
    console.log(`[ScanOrchestrator] Starting ${scanMode} scan`)
    const progress = this.config?.wss

    const results = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      findings: [],
      operations: {}
    }

    let enabledModules = this.normalizeModules(modules || [
      'api',
      'auth',
      'input',
      'secrets',
      'cve',
      'infra',
      'artemis'
    ])

    if (scanMode === 'full' && enabledModules.includes('browserUse')) {
      enabledModules = [
        'browserUse',
        ...enabledModules.filter((module) => module !== 'browserUse')
      ]
    }

    const runBrowserUse = Boolean(
      scanMode === 'full'
      && this.config?.modules?.browserUse
      && !enabledModules.includes('browserUse')
    )
    const totalStages = enabledModules.length + (runBrowserUse ? 1 : 0)
    let completedStages = 0

    const emitProgress = (phaseName) => {
      if (!progress) {
        return
      }
      const base = 10
      const weighted = totalStages > 0 ? Math.round((completedStages / totalStages) * 80) : 0
      progress.emit('scan_progress', {
        phase: scanMode,
        phaseName,
        percent: Math.min(92, base + weighted),
      })
    }

    // Run each module sequentially
    for (const module of enabledModules) {
      console.log(`[ScanOrchestrator] Running ${module} scanner...`)
      emitProgress(`running-${module}`)
      try {
        const moduleResult = await this.runModule(module, scanMode)
        const findings = Array.isArray(moduleResult)
          ? moduleResult
          : Array.isArray(moduleResult?.findings)
            ? moduleResult.findings
            : []

        results.findings.push(...findings)

        if (moduleResult && !Array.isArray(moduleResult)) {
          results.operations[module] = {
            ...(moduleResult?.diagnostics || {}),
            findingCount: findings.length
          }
        }
      } catch (e) {
        console.error(`[ScanOrchestrator] Error running ${module}:`, e.message)
      }
      completedStages += 1
      emitProgress(`completed-${module}`)
    }

    if (runBrowserUse) {
      try {
        emitProgress('running-browserUse')
        const browserResult = await this.runModule('browserUse', scanMode)
        const browserFindings = Array.isArray(browserResult)
          ? browserResult
          : Array.isArray(browserResult?.findings)
            ? browserResult.findings
            : []
        results.findings.push(...browserFindings)

        if (browserResult && !Array.isArray(browserResult)) {
          results.operations.browserUse = {
            ...(browserResult?.diagnostics || {}),
            findingCount: browserFindings.length
          }
        }
      } catch (e) {
        console.error('[ScanOrchestrator] Error running browserUse:', e.message)
      }
      completedStages += 1
      emitProgress('completed-browserUse')
    }

    for (const finding of results.findings) {
      const severity = String(finding.severity || 'low').toLowerCase()
      if (severity === 'critical') results.critical += 1
      else if (severity === 'high') results.high += 1
      else if (severity === 'medium') results.medium += 1
      else results.low += 1
    }

    console.log(`[ScanOrchestrator] Scan complete. Found ${results.findings.length} findings`)
    return results
  }

  normalizeModules(modules) {
    const map = {
      fuzzer: 'input',
      dependency: 'cve',
      nuclei: 'artemis'
    }

    return [...new Set(modules.map((m) => map[m] || m))]
  }

  async getRoutes() {
    if (this.routeCache) {
      return this.routeCache
    }

    try {
      this.routeCache = await this.discovery.discoverRoutes()
    } catch {
      this.routeCache = []
    }

    return this.routeCache
  }

  isAppMapOwnedRoute(route) {
    const rawPath = String(route?.path || '/').trim().toLowerCase()
    if (!rawPath) {
      return false
    }

    return rawPath === '/api'
      || rawPath.startsWith('/api/')
      || rawPath === '/rest'
      || rawPath.startsWith('/rest/')
  }

  async getScannerRoutes() {
    if (this.scannerRouteCache) {
      return this.scannerRouteCache
    }

    const routes = await this.getRoutes()
    this.scannerRouteCache = routes.filter((route) => !this.isAppMapOwnedRoute(route))
    return this.scannerRouteCache
  }

  async runModule(moduleName, scanMode) {
    const scannerRoutes = await this.getScannerRoutes()

    if (moduleName === 'api') {
      return await new ApiScanner(this.config).scan(scannerRoutes)
    }

    if (moduleName === 'auth') {
      return await new AuthScanner(this.config).scan(scannerRoutes)
    }

    if (moduleName === 'input') {
      return await new InputScanner(this.config).scan(scannerRoutes)
    }

    if (moduleName === 'secrets') {
      return await new SecretsScanner(this.config).scanRepo(this.config.project.path)
    }

    if (moduleName === 'cve') {
      const scanner = new CveScanner(this.config)
      return await scanner.scanNpmDependencies(this.config.project.path)
    }

    if (moduleName === 'infra') {
      return await new InfraScanner(this.config).scan()
    }

    if (moduleName === 'artemis') {
      const scanner = new ArtemisScanner(this.config)
      const result = await scanner.scan(this.config?.project?.targetUrl || '', {
        severity: 'critical,high'
      })

      return {
        findings: result?.findings || [],
        diagnostics: result?.diagnostics || { engine: 'artemis' }
      }
    }

    if (moduleName === 'db') {
      return await new DbScanner(this.config).scan()
    }

    if (moduleName === 'browserUse') {
      if (scanMode === 'quick') {
        return []
      }
      const orchestrator = new BrowserUseOrchestrator(this.config, null)
      return await orchestrator.runAll(scannerRoutes)
    }

    if (scanMode === 'quick') {
      return []
    }

    return []
  }
}

export default ScanOrchestrator
