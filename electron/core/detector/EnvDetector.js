class EnvDetector {
  async generateEnv(repoPath, frameworkInfo) {
    const baseEnv = {
      NODE_ENV: 'development',
      DATABASE_URL: `${this.dbUrlForType(frameworkInfo.dbType)}`,
      DOCKIUM_TARGET: `http://localhost:${frameworkInfo.appPort}`,
      DOCKIUM_PROXY: 'http://localhost:8080',
      DOCKIUM_ZAP: 'http://localhost:8090'
    }

    const envLines = Object.entries(baseEnv).map(([key, value]) => `${key}=${value}`)

    // Add framework-specific variables
    if (frameworkInfo.framework === 'nextjs') {
      envLines.push('NEXT_PUBLIC_API_URL=http://localhost:3000/api')
    }

    if (frameworkInfo.framework === 'express') {
      envLines.push('PORT=3000')
      envLines.push('API_PORT=3000')
    }

    if (frameworkInfo.framework === 'django') {
      envLines.push('DEBUG=True')
      envLines.push('DJANGO_SETTINGS_MODULE=config.settings')
      envLines.push('SECRET_KEY=DOCKIUM-DEV-KEY-CHANGE-IN-PROD')
    }

    if (frameworkInfo.framework === 'fastapi') {
      envLines.push('DEBUG=true')
      envLines.push('ENVIRONMENT=development')
    }

    if (frameworkInfo.framework === 'rails') {
      envLines.push('RAILS_ENV=development')
      envLines.push('SECRET_KEY_BASE=dockium-dev-key')
    }

    return envLines.join('\n')
  }

  dbUrlForType(dbType) {
    switch (dbType) {
      case 'postgres':
        return 'postgresql://dockium:dockium@dockium-db:5432/dockium_db'
      case 'mysql':
        return 'mysql://dockium:dockium@dockium-db:3306/dockium_db'
      case 'mongodb':
        return 'mongodb://dockium:dockium@dockium-db:27017/dockium_db'
      default:
        return 'postgresql://dockium:dockium@dockium-db:5432/dockium_db'
    }
  }
}

export default EnvDetector
