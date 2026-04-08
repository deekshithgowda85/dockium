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

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_DEFAULT_MODEL = "llama-3.1-8b-instant";

async function probeAiEndpoint(settings = {}) {
  const endpoint = String(settings?.reportLlmEndpoint || GROQ_CHAT_COMPLETIONS_URL).trim() || GROQ_CHAT_COMPLETIONS_URL;
  const model = String(settings?.reportLlmModel || GROQ_DEFAULT_MODEL).trim() || GROQ_DEFAULT_MODEL;
  const apiKey = String(settings?.reportLlmApiKey || "").trim();

  if (!apiKey) {
    return {
      ok: false,
      probe: {
        attempted: false,
        endpoint,
        status: 0,
        detail: "Missing Groq API key in Settings > Scanner (or Report).",
      },
    };
  }

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
    Authorization: /^bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Reply with OK only." },
            { role: "user", content: "Dockium scanner connectivity check" },
          ],
          temperature: 0,
          max_tokens: 8,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    return {
      ok: response.ok,
      probe: {
        attempted: true,
        endpoint,
        status: Number(response.status || 0),
        detail: response.ok ? "AI endpoint reachable." : `AI endpoint returned ${response.status}`,
      },
    };
  } catch (error) {
    return {
      ok: false,
      probe: {
        attempted: true,
        endpoint,
        status: 0,
        detail: String(error?.message || "AI endpoint probe failed"),
      },
    };
  }
}

function registerScanIpc(ipcMain, deps) {
  const {
    getProjectConfig,
    getSettings,
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
    let config = requestedTarget
      ? {
          ...baseConfig,
          project: {
            ...baseConfig.project,
            targetUrl: requestedTarget,
          },
        }
      : baseConfig;

    const settings = typeof getSettings === "function" ? getSettings() : null;
    if (settings && typeof settings === "object") {
      config = {
        ...config,
        settings,
        wss: getWss?.() || null,
      };
    } else {
      config = {
        ...config,
        wss: getWss?.() || null,
      };
    }

    const mode = payload.mode === "quick" ? "quick" : "full";
    const aiProbeResult = await probeAiEndpoint(settings || {});
    getWss()?.emitLog(
      aiProbeResult.ok
        ? `AI endpoint probe succeeded (${aiProbeResult?.probe?.endpoint || "unset"})`
        : `AI endpoint probe failed (${aiProbeResult?.probe?.detail || "unknown"})`,
      aiProbeResult.ok ? "info" : "warn"
    );

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
      operations: {
        ...(result.operations || {}),
        aiProbe: {
          attempted: Boolean(aiProbeResult?.probe?.attempted),
          ok: Boolean(aiProbeResult?.ok),
          endpoint: String(aiProbeResult?.probe?.endpoint || ""),
          status: Number(aiProbeResult?.probe?.status || 0),
          detail: String(aiProbeResult?.probe?.detail || ""),
          checkedAt: new Date().toISOString(),
        },
      },
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
        ? {
            phase: "completed",
            summary: scan.summary,
            completedAt: scan.completedAt,
            operations: scan.operations || {},
          }
        : { phase: "idle" },
    };
  });

  ipcMain.handle("scan:testAiConnection", async () => {
    const settings = typeof getSettings === "function" ? getSettings() : {};
    const result = await probeAiEndpoint(settings || {});
    getWss()?.emitLog(
      result.ok
        ? `AI endpoint probe succeeded (${result.probe.endpoint || "unset"})`
        : `AI endpoint probe failed (${result.probe.detail})`,
      result.ok ? "info" : "warn"
    );
    return result;
  });
}

module.exports = { registerScanIpc };
