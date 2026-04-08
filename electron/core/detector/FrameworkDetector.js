import fs from 'fs'
import path from 'path'

class FrameworkDetector {
  async detect(repoPath) {
    const packageJsonPath = path.join(repoPath, 'package.json')
    const pyProjectPath = path.join(repoPath, 'pyproject.toml')
    const gemfilePath = path.join(repoPath, 'Gemfile')
    const composerPath = path.join(repoPath, 'composer.json')
    const pom = path.join(repoPath, 'pom.xml')

    // Check for Node.js projects
    if (fs.existsSync(packageJsonPath)) {
      return this.detectNodeFramework(packageJsonPath, repoPath)
    }

    // Check for Python projects
    if (fs.existsSync(pyProjectPath) || fs.existsSync(path.join(repoPath, 'requirements.txt'))) {
      return this.detectPythonFramework(repoPath)
    }

    // Check for Ruby projects
    if (fs.existsSync(gemfilePath)) {
      return this.detectRubyFramework(gemfilePath, repoPath)
    }

    // Check for PHP projects
    if (fs.existsSync(composerPath)) {
      return this.detectPhpFramework(composerPath, repoPath)
    }

    // Check for Java projects
    if (fs.existsSync(pom)) {
      return this.detectJavaFramework(pom, repoPath)
    }

    throw new Error('Could not detect framework. Supported: Node.js, Python, Ruby, PHP, Java')
  }

  detectNodeFramework(packageJsonPath, repoPath) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }

    let framework = 'node'
    let version = pkg.version || '1.0.0'
    let dbType = 'postgres'
    let ormType = null

    // Detect Next.js
    if (deps.next) {
      framework = 'nextjs'
      version = deps.next
    }

    // Detect Express
    if (deps.express) {
      framework = 'express'
      version = deps.express
    }

    // Detect NestJS
    if (deps['@nestjs/core']) {
      framework = 'nestjs'
      version = deps['@nestjs/core']
    }

    // Detect Remix
    if (deps.remix) {
      framework = 'remix'
      version = deps.remix
    }

    // Detect Svelte
    if (deps.svelte || deps['@sveltejs/kit']) {
      framework = 'svelte'
      version = deps['@sveltejs/kit'] || deps.svelte
    }

    // Detect database type
    if (deps.mongodb) dbType = 'mongodb'
    if (deps.mysql2) dbType = 'mysql'
    if (deps['@mysql/mysql2']) dbType = 'mysql'
    if (deps.pg) dbType = 'postgres'
    if (deps.redis) dbType = 'redis'

    // Detect ORM
    if (deps.prisma) ormType = 'prisma'
    if (deps.sequelize) ormType = 'sequelize'
    if (deps.typeorm) ormType = 'typeorm'
    if (deps.mongoose) ormType = 'mongoose'

    return {
      framework,
      version,
      language: 'node',
      dbType,
      ormType: ormType || 'none',
      testCommand: pkg.scripts?.test || 'npm test',
      buildCommand: pkg.scripts?.build || 'npm run build'
    }
  }

  detectPythonFramework(repoPath) {
    const requirementsPath = path.join(repoPath, 'requirements.txt')
    const pyProjectPath = path.join(repoPath, 'pyproject.toml')

    let requirements = ''
    if (fs.existsSync(requirementsPath)) {
      requirements = fs.readFileSync(requirementsPath, 'utf8')
    } else if (fs.existsSync(pyProjectPath)) {
      requirements = fs.readFileSync(pyProjectPath, 'utf8')
    }

    let framework = 'python'
    let dbType = 'postgres'
    let ormType = 'none'

    if (requirements.includes('django')) {
      framework = 'django'
    } else if (requirements.includes('flask')) {
      framework = 'flask'
    } else if (requirements.includes('fastapi')) {
      framework = 'fastapi'
    }

    if (requirements.includes('psycopg')) dbType = 'postgres'
    if (requirements.includes('pymongo')) dbType = 'mongodb'
    if (requirements.includes('mysql')) dbType = 'mysql'
    if (requirements.includes('sqlalchemy')) ormType = 'sqlalchemy'

    return {
      framework,
      version: '3.9+',
      language: 'python',
      dbType,
      ormType,
      testCommand: 'pytest',
      buildCommand: 'pip install -r requirements.txt'
    }
  }

  detectRubyFramework(gemfilePath, repoPath) {
    const gemfile = fs.readFileSync(gemfilePath, 'utf8')

    let framework = 'ruby'
    let ormType = 'none'

    if (gemfile.includes("gem 'rails'")) {
      framework = 'rails'
    } else if (gemfile.includes("gem 'sinatra'")) {
      framework = 'sinatra'
    }

    if (gemfile.includes('activerecord')) ormType = 'activerecord'

    return {
      framework,
      version: 'latest',
      language: 'ruby',
      dbType: 'postgres',
      ormType,
      testCommand: 'rspec',
      buildCommand: 'bundle install'
    }
  }

  detectPhpFramework(composerPath, repoPath) {
    const composer = JSON.parse(fs.readFileSync(composerPath, 'utf8'))
    const requires = { ...composer.require, ...composer['require-dev'] }

    let framework = 'php'
    let ormType = 'none'

    if (requires['laravel/framework']) {
      framework = 'laravel'
    } else if (requires['symfony/framework-bundle']) {
      framework = 'symfony'
    }

    if (requires['doctrine/orm']) ormType = 'doctrine'

    return {
      framework,
      version: '8.0+',
      language: 'php',
      dbType: 'mysql',
      ormType,
      testCommand: 'phpunit',
      buildCommand: 'composer install'
    }
  }

  detectJavaFramework(pomPath, repoPath) {
    const pom = fs.readFileSync(pomPath, 'utf8')

    let framework = 'java'
    let ormType = 'none'

    if (pom.includes('spring-boot')) {
      framework = 'springboot'
    } else if (pom.includes('quarkus')) {
      framework = 'quarkus'
    }

    if (pom.includes('hibernate')) ormType = 'hibernate'
    if (pom.includes('jpa')) ormType = 'jpa'

    return {
      framework,
      version: '17+',
      language: 'java',
      dbType: 'postgres',
      ormType,
      testCommand: 'mvn test',
      buildCommand: 'mvn clean compile'
    }
  }
}

export default FrameworkDetector
