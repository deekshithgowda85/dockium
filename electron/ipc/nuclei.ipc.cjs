function bindIpcHandle(ipcMain, channel, handler) {
  try {
    ipcMain.removeHandler(channel)
  } catch {}
  ipcMain.handle(channel, handler)
}

function buildStatus(state) {
  return {
    active: state.active,
    scanId: state.scanId,
    targetUrl: state.targetUrl,
    percent: state.percent,
    phaseName: state.phaseName,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    lastError: state.lastError,
    findingsCount: state.findings.length,
  }
}

function registerNucleiIpc(ipcMain, deps) {
  const { getProjectConfig, createNucleiScanner, ensureNucleiRuntime, getWss } = deps

  const state = {
    active: false,
    scanId: null,
    targetUrl: '',
    percent: 0,
    phaseName: 'idle',
    startedAt: null,
    completedAt: null,
    lastError: '',
    findings: [],
  }

  let activePromise = null

  bindIpcHandle(ipcMain, 'nuclei:start', async (_event, payload = {}) => {
    const config = getProjectConfig?.()
    if (!config?.project?.targetUrl) {
      return { ok: false, error: 'No project loaded' }
    }

    if (state.active) {
      return { ok: true, status: buildStatus(state) }
    }

    const rawTarget = String(payload?.targetUrl || config.project.targetUrl || '').trim()
    if (!rawTarget) {
      return { ok: false, error: 'Missing target URL' }
    }

    const scanId = `nuclei-${Date.now()}`
    state.active = true
    state.scanId = scanId
    state.targetUrl = rawTarget
    state.percent = 10
    state.phaseName = 'starting'
    state.startedAt = new Date().toISOString()
    state.completedAt = null
    state.lastError = ''
    state.findings = []

    getWss?.()?.emit('nuclei_progress', buildStatus(state))
    getWss?.()?.emitLog(`Nuclei active scan started for ${rawTarget}`)

    activePromise = (async () => {
      try {
        await ensureNucleiRuntime?.(config)

        state.phaseName = 'preparing-templates'
        state.percent = 15
        getWss?.()?.emit('nuclei_progress', buildStatus(state))

        const scanner = createNucleiScanner(config)
        const result = await scanner.scan(rawTarget, {
          severity: 'critical,high',
          onLog: (message, level = 'info') => {
            getWss?.()?.emitLog(message, level)
          },
          onProgress: (progress) => {
            state.percent = Number(progress?.percent || state.percent || 45)
            state.phaseName = String(progress?.phaseName || 'running')
            if (progress?.candidateUrl) {
              state.targetUrl = String(progress.candidateUrl)
            }
            getWss?.()?.emit('nuclei_progress', buildStatus(state))
          },
        })

        state.findings = Array.isArray(result?.findings) ? result.findings : []
        state.targetUrl = String(result?.targetUrl || state.targetUrl)
        state.percent = 100
        state.phaseName = 'completed'
        state.completedAt = new Date().toISOString()
        getWss?.()?.emitLog(`Nuclei active scan completed (${state.findings.length} findings)`)
      } catch (error) {
        state.lastError = String(error?.message || 'Nuclei scan failed')
        state.phaseName = 'error'
        state.percent = 0
        state.completedAt = new Date().toISOString()
        getWss?.()?.emitLog(`Nuclei active scan failed: ${state.lastError}`, 'error')
      } finally {
        state.active = false
        getWss?.()?.emit('nuclei_progress', buildStatus(state))
      }
    })()

    activePromise.catch(() => {})

    return { ok: true, status: buildStatus(state) }
  })

  bindIpcHandle(ipcMain, 'nuclei:getStatus', async () => {
    return { ok: true, status: buildStatus(state) }
  })

  bindIpcHandle(ipcMain, 'nuclei:getFindings', async () => {
    if (state.active && activePromise) {
      // Return current partial state without blocking.
      return { ok: true, findings: state.findings, status: buildStatus(state) }
    }

    return { ok: true, findings: state.findings, status: buildStatus(state) }
  })

  bindIpcHandle(ipcMain, 'nuclei:reset', async () => {
    if (state.active) {
      return { ok: false, error: 'Nuclei scan is running. Wait for completion before resetting.' }
    }

    state.scanId = null
    state.targetUrl = ''
    state.percent = 0
    state.phaseName = 'idle'
    state.startedAt = null
    state.completedAt = null
    state.lastError = ''
    state.findings = []

    getWss?.()?.emit('nuclei_progress', buildStatus(state))
    return { ok: true, status: buildStatus(state) }
  })
}

module.exports = { registerNucleiIpc }
