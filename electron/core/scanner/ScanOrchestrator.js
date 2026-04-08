import ApiScanner from './modules/ApiScanner.js'
import AuthScanner from './modules/AuthScanner.js'
import InputScanner from './modules/InputScanner.js'
import SecretsScanner from './modules/SecretsScanner.js'
import CveScanner from './modules/CveScanner.js'
import InfraScanner from './modules/InfraScanner.js'
import DbScanner from './modules/DbScanner.js'
import NucleiScanner from './modules/NucleiScanner.js'
import DiscoveryEngine from './DiscoveryEngine.js'
import BrowserUseOrchestrator from '../browser/BrowserUseOrchestrator.js'

class ScanOrchestrator {
  constructor(config) {
    this.config = config
    this.discovery = new DiscoveryEngine(config, config.project.path)
    this.routeCache = null
  }

  async run(scanMode = 'full', modules = null) {
    console.log(`[ScanOrchestrator] Starting ${scanMode} scan`)

    const results = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      findings: []
    }

    const enabledModules = this.normalizeModules(modules || [
      'api',
      'auth',
      'input',
      'secrets',
      'cve',
      'infra',
      'nuclei'
    ])

    // Run each module sequentially
    for (const module of enabledModules) {
      console.log(`[ScanOrchestrator] Running ${module} scanner...`)
      try {
        const findings = await this.runModule(module, scanMode)
        results.findings.push(...findings)
      } catch (e) {
        console.error(`[ScanOrchestrator] Error running ${module}:`, e.message)
      }
    }

    if (scanMode === 'full' && this.config?.modules?.browserUse) {
      try {
        const browserFindings = await this.runModule('browserUse', scanMode)
        results.findings.push(...browserFindings)
      } catch (e) {
        console.error('[ScanOrchestrator] Error running browserUse:', e.message)
      }
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
      dependency: 'cve'
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

  async runModule(moduleName, scanMode) {
    const routes = await this.getRoutes()

    if (moduleName === 'api') {
      return await new ApiScanner(this.config).scan(routes)
    }

    if (moduleName === 'auth') {
      return await new AuthScanner(this.config).scan(routes)
    }

    if (moduleName === 'input') {
      return await new InputScanner(this.config).scan(routes)
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

    if (moduleName === 'nuclei') {
      const scanner = new NucleiScanner(this.config)
      return await scanner.scan(this.config?.project?.targetUrl || '', {
        severity: 'critical,high'
      }).then((result) => result.findings || [])
    }

    if (moduleName === 'db') {
      return await new DbScanner(this.config).scan()
    }

    if (moduleName === 'browserUse') {
      return await new BrowserUseOrchestrator(this.config, null).runAll()
    }

    if (scanMode === 'quick') {
      return []
    }

    return []
  }
}

export default ScanOrchestrator
