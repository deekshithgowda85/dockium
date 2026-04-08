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
    preflight: state.preflight,
    diagnostics: state.diagnostics,
  }
}

function fail(error, code, detail) {
  return {
    ok: false,
    error: String(error || 'Request failed'),
    code: Number(code || 500),
    detail: String(detail || ''),
  }
}

function registerNucleiIpc(ipcMain, deps) {
  const { getProjectConfig, createNucleiScanner, ensureNucleiRuntime, getWss } = deps

  function publishSnapshot(state) {
    deps?.onStateUpdate?.({
      status: buildStatus(state),
      findings: Array.isArray(state?.findings) ? [...state.findings] : [],
    })
  }

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
    preflight: null,
    diagnostics: {
      templateSetup: null,
      candidates: [],
    },
  }

  let activePromise = null

  bindIpcHandle(ipcMain, 'nuclei:start', async (_event, payload = {}) => {
    const config = getProjectConfig?.()
    if (!config?.project?.targetUrl) {
      return fail(
        'No project loaded. Open or import a project before running active scan.',
        400,
        'nuclei:start requires getProjectConfig().project.targetUrl'
      )
    }

    if (state.active) {
      return { ok: true, status: buildStatus(state) }
    }

    const rawTarget = String(payload?.targetUrl || config.project.targetUrl || '').trim()
    if (!rawTarget) {
      return fail('Missing target URL for Nuclei scan', 400, 'Provide payload.targetUrl or configure project target URL')
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
    state.preflight = null
    state.diagnostics = {
      templateSetup: null,
      candidates: [],
    }

    getWss?.()?.emit('nuclei_progress', buildStatus(state))
    publishSnapshot(state)
    getWss?.()?.emitLog(`Nuclei active scan started for ${rawTarget}`)

    activePromise = (async () => {
      try {
        const preflight = await ensureNucleiRuntime?.(config, {
          forceScannerRecreate: Boolean(payload?.forceScannerRecreate),
        })
        state.preflight = preflight || null

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
        state.diagnostics = {
          templateSetup: result?.diagnostics?.templateSetup || null,
          candidates: Array.isArray(result?.diagnostics?.candidates)
            ? result.diagnostics.candidates
            : [],
        }
        state.percent = 100
        state.phaseName = 'completed'
        state.completedAt = new Date().toISOString()
        getWss?.()?.emitLog(`Nuclei active scan completed (${state.findings.length} findings)`)
        publishSnapshot(state)
      } catch (error) {
        state.lastError = String(error?.message || 'Nuclei scan failed')
        state.diagnostics = {
          templateSetup: error?.templateSetup || null,
          candidates: Array.isArray(error?.candidateAttempts) ? error.candidateAttempts : [],
        }
        state.phaseName = 'error'
        state.percent = 0
        state.completedAt = new Date().toISOString()
        getWss?.()?.emitLog(`Nuclei active scan failed: ${state.lastError}`, 'error')
        publishSnapshot(state)
      } finally {
        state.active = false
        getWss?.()?.emit('nuclei_progress', buildStatus(state))
        publishSnapshot(state)
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
      return fail('Nuclei scan is running. Wait for completion before resetting.', 409, 'nuclei:reset blocked while active=true')
    }

    state.scanId = null
    state.targetUrl = ''
    state.percent = 0
    state.phaseName = 'idle'
    state.startedAt = null
    state.completedAt = null
    state.lastError = ''
    state.findings = []
    state.preflight = null
    state.diagnostics = {
      templateSetup: null,
      candidates: [],
    }

    getWss?.()?.emit('nuclei_progress', buildStatus(state))
    publishSnapshot(state)
    return { ok: true, status: buildStatus(state) }
  })
}

module.exports = { registerNucleiIpc }
