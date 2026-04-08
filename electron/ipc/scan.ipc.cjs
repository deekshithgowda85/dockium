function summarizeFindings(findings) {
  const summary = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  findings.forEach((finding) => {
    const key = String(finding.severity || "info").toLowerCase();
    if (summary[key] !== undefined) {
      summary[key] += 1;
    } else {
      summary.info += 1;
    }
  });
  return summary;
}

function registerScanIpc(ipcMain, deps) {
  const {
    getProjectConfig,
    createScanOrchestrator,
    buildReport,
    setLastScan,
    setLatestReport,
    getWss,
    ensureScanRuntime,
  } = deps;

  ipcMain.handle("scan:start", async (_event, payload = {}) => {
    const baseConfig = getProjectConfig();
    if (!baseConfig) {
      return { ok: false, error: "No project loaded" };
    }

    const requestedTarget = String(payload.targetUrl || "").trim();
    const config = requestedTarget
      ? {
          ...baseConfig,
          project: {
            ...baseConfig.project,
            targetUrl: requestedTarget,
          },
        }
      : baseConfig;

    const mode = payload.mode === "quick" ? "quick" : "full";
    await ensureScanRuntime?.(config);
    const orchestrator = createScanOrchestrator(config);
    getWss()?.emitLog(`Scan started (${mode})`);
    getWss()?.emit("scan_progress", { phase: mode, percent: 5, phaseName: "starting" });

    const startedAt = Date.now();
    const result = await orchestrator.run(mode, payload.modules || null);
    const durationMs = Date.now() - startedAt;
    const summary = summarizeFindings(result.findings || []);
    getWss()?.emit("scan_progress", { phase: mode, percent: 95, phaseName: "finalizing" });

    const completed = {
      mode,
      durationMs,
      findings: result.findings || [],
      summary,
      completedAt: new Date().toISOString(),
    };

    setLastScan(completed);
    try {
      const report = await buildReport(completed);
      setLatestReport(report);
      getWss()?.emit("scan_complete", { summary: report.summary, findings: report.findings?.length || 0 });
    } catch (error) {
      getWss()?.emitLog(`Report build warning: ${error.message}`, "warn");
    }
    getWss()?.emitLog(`Scan completed (${summary.total} findings)`);

    return { ok: true, scan: completed };
  });

  ipcMain.handle("scan:stop", async () => {
    // Placeholder: orchestrator currently runs to completion.
    return { ok: true, stopped: true };
  });

  ipcMain.handle("scan:getFindings", async () => {
    const scan = deps.getLastScan();
    return { ok: true, findings: scan?.findings || [] };
  });

  ipcMain.handle("scan:getStatus", async () => {
    const scan = deps.getLastScan();
    return {
      ok: true,
      status: scan
        ? { phase: "completed", summary: scan.summary, completedAt: scan.completedAt }
        : { phase: "idle" },
    };
  });
}

module.exports = { registerScanIpc };
