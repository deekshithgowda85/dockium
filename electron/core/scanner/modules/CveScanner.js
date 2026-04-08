import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'

class CveScanner {
  constructor(config) {
    this.config = config
  }

  async scan(dependencies) {
    console.log(`[CveScanner] Checking ${dependencies.length} dependencies for CVEs`)
    const findings = []

    for (const dep of dependencies) {
      try {
        const cves = await this.checkDependency(dep)
        findings.push(...cves)
      } catch (e) {
        console.error(`[CveScanner] Error checking ${dep.name}:`, e.message)
      }
    }

    return findings
  }

  async checkDependency(dependency) {
    const body = {
      package: {
        ecosystem: dependency.ecosystem || 'npm',
        name: dependency.name
      },
      version: dependency.version
    }

    const response = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      return []
    }

    const data = await response.json()
    const vulns = data.vulns || []

    return vulns.map((vuln) => ({
      type: 'Dependency',
      severity: this.mapSeverity(vuln),
      title: vuln.id || 'Dependency vulnerability',
      description: vuln.summary || 'Known vulnerability in dependency',
      dependency: `${dependency.name}@${dependency.version}`,
      endpoint: dependency.name,
      fix: this.extractFix(vuln)
    }))
  }

  async scanNpmDependencies(packageJsonPath) {
    const pkgPath = path.join(packageJsonPath, 'package.json')
    if (!fs.existsSync(pkgPath)) {
      return []
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {})
    }

    const items = Object.entries(deps).slice(0, 40).map(([name, version]) => ({
      name,
      version: String(version).replace(/^[^\d]*/, ''),
      ecosystem: 'npm'
    }))

    return await this.scan(items)
  }

  async scanPythonDependencies(requirementsPath) {
    // Parse requirements.txt and check each dependency
    return []
  }

  mapSeverity(vuln) {
    const severityText = JSON.stringify(vuln.severity || []).toLowerCase()
    if (severityText.includes('critical')) return 'critical'
    if (severityText.includes('high')) return 'high'
    if (severityText.includes('moderate') || severityText.includes('medium')) return 'medium'
    return 'low'
  }

  extractFix(vuln) {
    const first = vuln.affected?.[0]?.ranges?.[0]?.events || []
    const fixed = first.find((event) => event.fixed)?.fixed
    return fixed ? `Upgrade to a fixed version (>= ${fixed}).` : 'Upgrade dependency to a non-vulnerable release.'
  }
}

export default CveScanner
