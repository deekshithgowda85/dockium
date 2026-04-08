import Docker from 'dockerode'

const docker = new Docker()
const NUCLEI_IMAGE = 'projectdiscovery/nuclei:latest'
const TEMPLATE_SYNC_IMAGE = 'alpine/git:latest'
const NUCLEI_TEMPLATE_DIR = '/root/nuclei-templates'
const NUCLEI_ALT_TEMPLATE_DIR = '/home/nonroot/nuclei-templates'
const NUCLEI_TEMPLATE_VOLUME = 'dockium-nuclei-templates'

function normalizeTargetUrl(targetUrl) {
  const raw = String(targetUrl || '').trim()
  if (!raw) {
    return ''
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw
  }

  return `http://${raw}`
}

function normalizeSeverity(value) {
  const severity = String(value || 'medium').toLowerCase()
  if (['critical', 'high', 'medium', 'low', 'info'].includes(severity)) {
    return severity
  }
  return 'medium'
}

function stripAnsi(value) {
  return String(value || '')
    .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}

class NucleiScanner {
  constructor(config) {
    this.config = config
    this.networkName = 'dockium-net'
  }

  buildTargetCandidates(targetUrl) {
    const normalized = normalizeTargetUrl(targetUrl)
    if (!normalized) {
      return []
    }

    const candidates = []

    try {
      const parsed = new URL(normalized)
      const host = parsed.hostname.toLowerCase()
      if (host === 'localhost' || host === '127.0.0.1') {
        const hostInternal = new URL(parsed.toString())
        hostInternal.hostname = 'host.docker.internal'
        candidates.push(hostInternal.toString())

        const appContainer = new URL(parsed.toString())
        appContainer.hostname = 'dockium-app'
        candidates.push(appContainer.toString())
      }
      candidates.push(parsed.toString())
    } catch {
      candidates.push(normalized)
    }

    return [...new Set(candidates)]
  }

  async ensureImage(onLog) {
    try {
      await docker.getImage(NUCLEI_IMAGE).inspect()
      return
    } catch {}

    onLog?.(`Pulling Nuclei image (${NUCLEI_IMAGE})...`)
    const stream = await docker.pull(NUCLEI_IMAGE)
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    onLog?.(`Pulled Nuclei image (${NUCLEI_IMAGE})`)
  }

  async ensureTemplateSyncImage(onLog) {
    try {
      await docker.getImage(TEMPLATE_SYNC_IMAGE).inspect()
      return
    } catch {}

    onLog?.(`Pulling template sync image (${TEMPLATE_SYNC_IMAGE})...`)
    const stream = await docker.pull(TEMPLATE_SYNC_IMAGE)
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    onLog?.(`Pulled template sync image (${TEMPLATE_SYNC_IMAGE})`)
  }

  parseFindings(outputText, fallbackEndpoint) {
    const lines = String(outputText || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    const findings = []

    lines.forEach((line, index) => {
      if (!line.startsWith('{')) {
        return
      }

      try {
        const entry = JSON.parse(line)
        const severity = normalizeSeverity(entry?.info?.severity)
        const name = String(entry?.info?.name || entry?.['template-id'] || 'Nuclei finding')
        const endpoint = String(entry?.['matched-at'] || entry?.host || fallbackEndpoint || '--')
        const references = Array.isArray(entry?.info?.reference)
          ? entry.info.reference.join(', ')
          : String(entry?.info?.reference || '')
        const extracted = Array.isArray(entry?.['extracted-results'])
          ? entry['extracted-results'].join(', ')
          : ''

        findings.push({
          id: `nuclei-${Date.now()}-${index}`,
          type: 'Nuclei',
          severity,
          title: name,
          description: String(entry?.info?.description || `Matched template ${entry?.['template-id'] || 'unknown'}`),
          endpoint,
          payload: String(entry?.['template-id'] || 'n/a'),
          response: endpoint,
          proof: extracted || String(entry?.['matcher-name'] || entry?.matched || 'Template match detected'),
          fix: references || 'Review the impacted endpoint and apply remediation from template guidance.',
          request: String(entry?.['curl-command'] || 'n/a'),
        })
      } catch {
        // Ignore non-JSON log lines.
      }
    })

    if (findings.length > 0) {
      return findings
    }

    // Fallback for versions that emit one JSON object/array instead of JSONL.
    try {
      const parsed = JSON.parse(String(outputText || '').trim())
      const records = Array.isArray(parsed) ? parsed : [parsed]

      records.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          return
        }

        const severity = normalizeSeverity(entry?.info?.severity)
        const name = String(entry?.info?.name || entry?.['template-id'] || 'Nuclei finding')
        const endpoint = String(entry?.['matched-at'] || entry?.host || fallbackEndpoint || '--')
        const references = Array.isArray(entry?.info?.reference)
          ? entry.info.reference.join(', ')
          : String(entry?.info?.reference || '')
        const extracted = Array.isArray(entry?.['extracted-results'])
          ? entry['extracted-results'].join(', ')
          : ''

        findings.push({
          id: `nuclei-${Date.now()}-${index}`,
          type: 'Nuclei',
          severity,
          title: name,
          description: String(entry?.info?.description || `Matched template ${entry?.['template-id'] || 'unknown'}`),
          endpoint,
          payload: String(entry?.['template-id'] || 'n/a'),
          response: endpoint,
          proof: extracted || String(entry?.['matcher-name'] || entry?.matched || 'Template match detected'),
          fix: references || 'Review the impacted endpoint and apply remediation from template guidance.',
          request: String(entry?.['curl-command'] || 'n/a'),
        })
      })
    } catch {}

    // Fallback for plain-text output when JSON flags are unavailable.
    const textLines = stripAnsi(outputText)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    textLines.forEach((line, index) => {
      const severityMatch = line.match(/\[(critical|high|medium|low|info)\]/i)
      if (!severityMatch) {
        return
      }

      const severity = normalizeSeverity(severityMatch[1])
      const firstTokenMatch = line.match(/^\[([^\]]+)\]/)
      const endpointMatch = line.match(/https?:\/\/\S+/i)

      findings.push({
        id: `nuclei-${Date.now()}-${index}`,
        type: 'Nuclei',
        severity,
        title: firstTokenMatch?.[1] || 'Nuclei finding',
        description: line,
        endpoint: endpointMatch?.[0] || fallbackEndpoint || '--',
        payload: firstTokenMatch?.[1] || 'n/a',
        response: endpointMatch?.[0] || fallbackEndpoint || '--',
        proof: line,
        fix: 'Review the impacted endpoint and apply remediation from template guidance.',
        request: 'n/a',
      })
    })

    return findings
  }

  summarizeErrorOutput(outputText) {
    const lines = stripAnsi(outputText)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    const tail = lines.slice(-6)
    return tail.join(' | ') || 'Nuclei scan failed'
  }

  getTemplateBind() {
    return `${NUCLEI_TEMPLATE_VOLUME}:${NUCLEI_TEMPLATE_DIR}`
  }

  getTemplateBinds() {
    return [
      this.getTemplateBind(),
      `${NUCLEI_TEMPLATE_VOLUME}:${NUCLEI_ALT_TEMPLATE_DIR}`,
    ]
  }

  async ensureTemplateVolume(onLog) {
    try {
      await docker.getVolume(NUCLEI_TEMPLATE_VOLUME).inspect()
      return
    } catch {}

    await docker.createVolume({ Name: NUCLEI_TEMPLATE_VOLUME })
    onLog?.(`Created Docker volume ${NUCLEI_TEMPLATE_VOLUME} for Nuclei templates`)
  }

  async runContainerCommand(command, options = {}) {
    const binds = Array.isArray(options.binds) ? options.binds : []
    const networkMode = String(options.networkMode || this.networkName)

    const container = await docker.createContainer({
      Image: NUCLEI_IMAGE,
      Tty: true,
      Cmd: command,
      HostConfig: {
        NetworkMode: networkMode,
        Binds: binds,
      },
    })

    try {
      await container.start()
      const waitResult = await container.wait()
      const logsBuffer = await container.logs({ stdout: true, stderr: true })
      const outputText = Buffer.isBuffer(logsBuffer)
        ? logsBuffer.toString('utf8')
        : String(logsBuffer || '')

      return {
        waitResult,
        outputText,
      }
    } finally {
      try {
        await container.remove({ force: true, v: true })
      } catch {}
    }
  }

  async ensureTemplates(onLog) {
    await this.ensureTemplateVolume(onLog)

    const updateVariants = [
      ['-update-templates', '-update-template-dir', NUCLEI_TEMPLATE_DIR, '-silent'],
      ['-update-templates', '-update-template-dir', NUCLEI_ALT_TEMPLATE_DIR, '-silent'],
      ['-ut', '-ud', NUCLEI_TEMPLATE_DIR, '-silent'],
      ['-ut', '-ud', NUCLEI_ALT_TEMPLATE_DIR, '-silent'],
      ['-update-templates', '-silent'],
      ['-ut', '-silent'],
    ]

    let lastOutput = ''
    let lastStatusCode = 0

    for (const command of updateVariants) {
      const { waitResult, outputText } = await this.runContainerCommand(command, {
        networkMode: 'bridge',
        binds: this.getTemplateBinds(),
      })

      lastOutput = outputText
      lastStatusCode = Number(waitResult?.StatusCode || 0)

      const hasUnknownFlag = /flag provided but not defined:\s+-\S+/i.test(outputText)
      if (hasUnknownFlag) {
        continue
      }

      if (lastStatusCode !== 0) {
        onLog?.(`Nuclei template update warning: ${this.summarizeErrorOutput(outputText)}`, 'warn')
      } else {
        onLog?.('Nuclei templates are ready')
      }
      return
    }

    if (lastOutput) {
      onLog?.(`Nuclei template setup warning: ${this.summarizeErrorOutput(lastOutput)}`, 'warn')
    } else {
      onLog?.(`Nuclei template setup warning: update command failed with code ${lastStatusCode || 1}`, 'warn')
    }

    await this.syncTemplatesFromGit(onLog)
  }

  async syncTemplatesFromGit(onLog) {
    await this.ensureTemplateSyncImage(onLog)
    onLog?.('Syncing Nuclei templates from projectdiscovery/nuclei-templates...')

    const command = [
      'sh',
      '-lc',
      [
        'set -e',
        'rm -rf /templates/.sync-temp',
        'git clone --depth=1 https://github.com/projectdiscovery/nuclei-templates.git /templates/.sync-temp',
        'cp -R /templates/.sync-temp/* /templates/',
        'rm -rf /templates/.sync-temp',
      ].join(' && '),
    ]

    const container = await docker.createContainer({
      Image: TEMPLATE_SYNC_IMAGE,
      Tty: true,
      Cmd: command,
      HostConfig: {
        NetworkMode: 'bridge',
        Binds: [`${NUCLEI_TEMPLATE_VOLUME}:/templates`],
      },
    })

    try {
      await container.start()
      const waitResult = await container.wait()
      const logsBuffer = await container.logs({ stdout: true, stderr: true })
      const outputText = Buffer.isBuffer(logsBuffer) ? logsBuffer.toString('utf8') : String(logsBuffer || '')

      if (Number(waitResult?.StatusCode || 0) !== 0) {
        throw new Error(this.summarizeErrorOutput(outputText))
      }

      onLog?.('Nuclei templates synced successfully')
    } finally {
      try {
        await container.remove({ force: true, v: true })
      } catch {}
    }
  }

  async scanCandidate(candidateUrl, options = {}) {
    const severity = String(options.severity || 'critical,high').trim() || 'critical,high'
    const baseCommandVariants = [
      ['-u', candidateUrl, '-severity', severity, '-silent'],
      ['-u', candidateUrl, '-severity', severity],
      ['-u', candidateUrl, '-s', severity, '-silent'],
      ['-u', candidateUrl, '-s', severity],
      ['-u', candidateUrl, '-silent'],
      ['-u', candidateUrl],
    ]

    const templateArgVariants = [
      ['-t', NUCLEI_TEMPLATE_DIR],
      ['-t', `${NUCLEI_TEMPLATE_DIR}/nuclei-templates`],
      ['-t', NUCLEI_ALT_TEMPLATE_DIR],
      ['-t', `${NUCLEI_ALT_TEMPLATE_DIR}/nuclei-templates`],
      [],
    ]

    const outputFlagVariants = [
      [],
      ['-jsonl'],
      ['-json'],
    ]

    const runMatrix = async () => {
      let lastOutputLocal = ''
      let lastStatusCodeLocal = 0

      for (const baseCommand of baseCommandVariants) {
        for (const templateArgs of templateArgVariants) {
          for (const outputFlag of outputFlagVariants) {
            const command = [...outputFlag, ...baseCommand, ...templateArgs]
            const { waitResult, outputText } = await this.runContainerCommand(command, {
              networkMode: this.networkName,
              binds: this.getTemplateBinds(),
            })
            lastOutputLocal = outputText
            lastStatusCodeLocal = Number(waitResult?.StatusCode || 0)

            const unsupportedFlag = /flag provided but not defined:\s+-\S+/i.test(outputText)
            if (unsupportedFlag) {
              continue
            }

            const noTemplates = this.summarizeErrorOutput(outputText)
              .toLowerCase()
              .includes('no templates provided for scan')
            if (noTemplates) {
              continue
            }

            const findings = this.parseFindings(outputText, candidateUrl)
            if (lastStatusCodeLocal !== 0) {
              const detail = this.summarizeErrorOutput(outputText)
              throw new Error(`Nuclei exited with code ${lastStatusCodeLocal}. ${detail}`)
            }

            return {
              done: true,
              result: {
                candidateUrl,
                findings,
                outputText,
              },
              lastOutput: lastOutputLocal,
              lastStatusCode: lastStatusCodeLocal,
            }
          }
        }
      }

      return {
        done: false,
        result: null,
        lastOutput: lastOutputLocal,
        lastStatusCode: lastStatusCodeLocal,
      }
    }

    let lastOutput = ''
    let lastStatusCode = 0

    const firstAttempt = await runMatrix()
    lastOutput = firstAttempt.lastOutput
    lastStatusCode = firstAttempt.lastStatusCode
    if (firstAttempt.done) {
      return firstAttempt.result
    }

    const noTemplatesAfterFirstPass = this.summarizeErrorOutput(lastOutput)
      .toLowerCase()
      .includes('no templates provided for scan')

    if (noTemplatesAfterFirstPass) {
      options?.onLog?.('Nuclei templates missing during scan; forcing git template sync...', 'warn')
      await this.syncTemplatesFromGit(options?.onLog)

      const secondAttempt = await runMatrix()
      lastOutput = secondAttempt.lastOutput
      lastStatusCode = secondAttempt.lastStatusCode
      if (secondAttempt.done) {
        return secondAttempt.result
      }
    }

    const detail = this.summarizeErrorOutput(lastOutput)
    throw new Error(`Nuclei exited with code ${lastStatusCode || 2}. ${detail}`)
  }

  async scan(targetUrl, options = {}) {
    const onLog = options.onLog
    const onProgress = options.onProgress
    const candidates = this.buildTargetCandidates(targetUrl)

    if (candidates.length === 0) {
      throw new Error('Missing valid target URL for Nuclei scan')
    }

    await this.ensureImage(onLog)
    onLog?.('Running Nuclei in Docker')
    await this.ensureTemplates(onLog)

    let lastError = null

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]
      const phasePercent = Math.min(85, 20 + index * 25)
      onProgress?.({ phaseName: 'running', percent: phasePercent, candidateUrl: candidate })
      onLog?.(`Running Nuclei against ${candidate}`)

      try {
        const result = await this.scanCandidate(candidate, options)
        return {
          targetUrl: candidate,
          findings: result.findings,
        }
      } catch (error) {
        lastError = error
        onLog?.(`Nuclei candidate failed (${candidate}): ${String(error?.message || 'unknown error')}`, 'warn')
      }
    }

    throw lastError || new Error('Nuclei scan failed for all target candidates')
  }
}

export default NucleiScanner
