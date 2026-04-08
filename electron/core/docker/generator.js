import path from 'path'
import fs from 'fs'

const NODE_TEMPLATES = {
  nextjs: (version, appPort) => `
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
EXPOSE ${appPort}
CMD ["npm", "start"]
`,

  express: (version, appPort) => `
FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE ${appPort}
CMD ["npm", "start"]
`,

  nestjs: (version, appPort) => `
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --production
COPY --from=builder /app/dist ./dist
EXPOSE ${appPort}
CMD ["node", "dist/main.js"]
`,

  remix: (version, appPort) => `
FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE ${appPort}
CMD ["npm", "start"]
`
}

const PYTHON_TEMPLATES = {
  django: (version, appPort) => `
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE ${appPort}
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:${appPort}"]
`,

  fastapi: (version, appPort) => `
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE ${appPort}
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${appPort}"]
`,

  flask: (version, appPort) => `
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE ${appPort}
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:${appPort}"]
`
}

const RUBY_TEMPLATES = {
  rails: (version, appPort) => `
FROM ruby:3.1-slim
WORKDIR /app
RUN apt-get update && apt-get install -y build-essential
COPY Gemfile Gemfile.lock ./
RUN bundle install
COPY . .
EXPOSE ${appPort}
CMD ["bundle", "exec", "rails", "server", "-b", "0.0.0.0", "-p", "${appPort}"]
`,

  sinatra: (version, appPort) => `
FROM ruby:3.1-slim
WORKDIR /app
COPY Gemfile Gemfile.lock ./
RUN bundle install
COPY . .
EXPOSE ${appPort}
CMD ["bundle", "exec", "ruby", "app.rb", "-o", "0.0.0.0", "-p", "${appPort}"]
`
}

const PHP_TEMPLATES = {
  laravel: (version, appPort) => `
FROM php:8.1-fpm
WORKDIR /app
RUN apt-get update && apt-get install -y composer
COPY composer.json composer.lock ./
RUN composer install --no-dev
COPY . .
EXPOSE ${appPort}
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=${appPort}"]
`,

  symfony: (version, appPort) => `
FROM php:8.1-fpm
WORKDIR /app
RUN apt-get update && apt-get install -y composer
COPY composer.json composer.lock ./
RUN composer install --no-dev
COPY . .
EXPOSE ${appPort}
CMD ["php", "-S", "0.0.0.0:${appPort}", "-t", "public"]
`
}

const JAVA_TEMPLATES = {
  springboot: (version, appPort) => `
FROM maven:3.8-openjdk-17 AS builder
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline
COPY . .
RUN mvn clean package -DskipTests

FROM openjdk:17-slim
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
EXPOSE ${appPort}
ENV JAVA_OPTS="-Xmx512m"
CMD ["java", "-jar", "app.jar"]
`,

  quarkus: (version, appPort) => `
FROM maven:3.8-openjdk-17 AS builder
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline
COPY . .
RUN mvn clean package -DskipTests

FROM openjdk:17-slim
WORKDIR /app
COPY --from=builder /app/target/*-runner.jar app.jar
EXPOSE ${appPort}
CMD ["java", "-jar", "app.jar"]
`
}

export async function generateDockerfile(repoPath, frameworkInfo) {
  let template = null
  const appPort = frameworkInfo.appPort || 3000

  if (frameworkInfo.language === 'node') {
    template = NODE_TEMPLATES[frameworkInfo.framework] || NODE_TEMPLATES.express
  } else if (frameworkInfo.language === 'python') {
    template = PYTHON_TEMPLATES[frameworkInfo.framework] || PYTHON_TEMPLATES.flask
  } else if (frameworkInfo.language === 'ruby') {
    template = RUBY_TEMPLATES[frameworkInfo.framework] || RUBY_TEMPLATES.rails
  } else if (frameworkInfo.language === 'php') {
    template = PHP_TEMPLATES[frameworkInfo.framework] || PHP_TEMPLATES.laravel
  } else if (frameworkInfo.language === 'java') {
    template = JAVA_TEMPLATES[frameworkInfo.framework] || JAVA_TEMPLATES.springboot
  }

  if (!template) {
    throw new Error(`Unsupported framework: ${frameworkInfo.framework}`)
  }

  const dockerfile = template(frameworkInfo.version, appPort)
  const dockerfilePath = path.join(repoPath, '.dockium.Dockerfile')
  fs.writeFileSync(dockerfilePath, dockerfile.trim())

  return dockerfilePath
}
