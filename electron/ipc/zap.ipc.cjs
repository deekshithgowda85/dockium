function buildIdleStatus(state) {
  return {
    active: state.active,
    scanId: state.scanId,
    targetUrl: state.targetUrl,
    percent: state.percent,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    lastError: state.lastError,
    alertsCount: state.alerts.length,
  };
}

function bindIpcHandle(ipcMain, channel, handler) {
  try {
    ipcMain.removeHandler(channel);
  } catch {}
  ipcMain.handle(channel, handler);
}

function registerZapIpc(ipcMain, deps) {
  const { getProjectConfig, createZapBridge, ensureZapRunning, getWss } = deps;
  const state = {
    active: false,
    scanId: null,
    targetUrl: "",
    percent: 0,
    startedAt: null,
    completedAt: null,
    lastError: "",
    alerts: [],
  };

  bindIpcHandle(ipcMain, "zap:start", async (_event, payload = {}) => {
    const config = getProjectConfig();
    if (!config?.project?.targetUrl) {
      return { ok: false, error: "No project loaded" };
    }

    if (state.active && state.scanId) {
      return { ok: true, status: { ...buildIdleStatus(state), active: true } };
    }

    const rawTarget = String(payload.targetUrl || config.project.targetUrl).trim();
    if (!rawTarget) {
      return { ok: false, error: "Missing target URL" };
    }
    const targetUrl = /^https?:\/\//i.test(rawTarget) ? rawTarget : `http://${rawTarget}`;

    try {
      await ensureZapRunning?.(config);

      const bridge = createZapBridge();
      const startResult = await bridge.startActiveScan(targetUrl);
      const scanId = typeof startResult === "object" && startResult !== null
        ? String(startResult.scanId || "")
        : String(startResult || "");
      const resolvedTargetUrl = typeof startResult === "object" && startResult !== null
        ? String(startResult.targetUrl || targetUrl)
        : targetUrl;

      state.active = true;
      state.scanId = scanId;
      state.targetUrl = resolvedTargetUrl;
      state.percent = 0;
      state.startedAt = new Date().toISOString();
      state.completedAt = null;
      state.lastError = "";
      state.alerts = [];

      getWss()?.emitLog(
        resolvedTargetUrl === targetUrl
          ? `ZAP active scan started for ${resolvedTargetUrl}`
          : `ZAP active scan started for ${resolvedTargetUrl} (requested: ${targetUrl})`,
      );
      getWss()?.emit("zap_progress", {
        scanId: state.scanId,
        targetUrl: state.targetUrl,
        percent: state.percent,
        active: true,
      });

      return { ok: true, status: { ...buildIdleStatus(state), active: true } };
    } catch (error) {
      const message = String(error?.message || "Failed to start ZAP scan");
      state.lastError = message;
      return { ok: false, error: message };
    }
  });

  bindIpcHandle(ipcMain, "zap:getStatus", async () => {
    const config = getProjectConfig();
    if (!state.targetUrl && config?.project?.targetUrl) {
      state.targetUrl = String(config.project.targetUrl);
    }

    if (!state.scanId) {
      return { ok: true, status: buildIdleStatus(state) };
    }

    try {
      const bridge = createZapBridge();
      const percent = await bridge.getScanProgress(state.scanId);
      state.percent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : state.percent;

      if (state.percent >= 100 && state.active) {
        state.active = false;
        state.completedAt = new Date().toISOString();
        state.alerts = await bridge.getAlerts();
        getWss()?.emitLog(`ZAP active scan completed (${state.alerts.length} alerts)`);
      }

      const payload = {
        scanId: state.scanId,
        targetUrl: state.targetUrl,
        percent: state.percent,
        active: state.active,
      };
      getWss()?.emit("zap_progress", payload);
      return { ok: true, status: buildIdleStatus(state) };
    } catch (error) {
      const message = String(error?.message || "Failed to read ZAP status");
      state.lastError = message;
      return { ok: false, error: message, status: buildIdleStatus(state) };
    }
  });

  bindIpcHandle(ipcMain, "zap:getAlerts", async () => {
    try {
      const bridge = createZapBridge();
      const alerts = await bridge.getAlerts();
      state.alerts = alerts;
      return { ok: true, alerts };
    } catch (error) {
      return { ok: false, error: String(error?.message || "Failed to fetch ZAP alerts") };
    }
  });

  bindIpcHandle(ipcMain, "zap:reset", async () => {
    state.active = false;
    state.scanId = null;
    state.targetUrl = "";
    state.percent = 0;
    state.startedAt = null;
    state.completedAt = null;
    state.lastError = "";
    state.alerts = [];
    return { ok: true, status: buildIdleStatus(state) };
  });
}

module.exports = { registerZapIpc };
