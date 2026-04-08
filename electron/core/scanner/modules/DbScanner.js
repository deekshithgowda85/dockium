class DbScanner {
  constructor(config) {
    this.config = config
  }

  async scan() {
    const findings = []
    const dbType = this.config?.project?.dbType || 'unknown'

    if (!['postgres', 'mysql', 'mongodb'].includes(dbType)) {
      findings.push({
        type: 'Database',
        severity: 'low',
        title: 'Unknown DB Type',
        description: 'Database type is not recognized. DB security checks are limited.',
        endpoint: 'database',
        fix: 'Set a supported database type in project configuration.'
      })
    }

    const hasDefaultCredentials = String(this.config?.credentials?.adminPassword || '').includes('Password123!')
    if (hasDefaultCredentials) {
      findings.push({
        type: 'Database',
        severity: 'high',
        title: 'Default Credentials in Runtime Config',
        description: 'Default seed credentials are still present in runtime configuration.',
        endpoint: 'database',
        fix: 'Rotate admin/test credentials before production scans.'
      })
    }

    return findings
  }
}

export default DbScanner
