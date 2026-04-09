import { create } from "zustand";

const scannerModules = [
  { id: "browserUse", label: "Browser Use", enabled: true },
  { id: "api", label: "API Scanner", enabled: true },
  { id: "auth", label: "Auth Scanner", enabled: true },
  { id: "fuzzer", label: "Input Fuzzer", enabled: true },
  { id: "infra", label: "Infra Scanner", enabled: true },
  { id: "secrets", label: "Secrets Scan", enabled: true },
  { id: "cve", label: "Dependency CVE", enabled: true },
  { id: "artemis", label: "Artemis Active", enabled: true },
];

function nowClock() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function toDuration(durationMs) {
  const sec = Math.max(0, Math.floor((durationMs || 0) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function normalizeFinding(finding) {
  const statusCode = Number(
    finding.statusCode
      ?? finding.responseStatus
      ?? finding.httpStatus
      ?? 0,
  );
  const cvssValue = Number(finding.cvss ?? finding.cvssScore ?? 0);

  return {
    id: finding.id || `f-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    severity: String(finding.severity || "info").toLowerCase(),
    title: finding.title || finding.name || "Untitled finding",
    endpoint: finding.endpoint || finding.url || "Unknown endpoint",
    method: String(finding.method || finding.httpMethod || "GET").toUpperCase(),
    module: finding.module || finding.scanner || finding.source || "scanner",
    category: finding.category || finding.type || "security",
    cwe: finding.cwe || finding.cweId || "",
    cve: finding.cve || finding.cveId || "",
    cvss: Number.isFinite(cvssValue) && cvssValue > 0 ? cvssValue.toFixed(1) : "",
    confidence: String(finding.confidence || finding.certainty || "medium").toLowerCase(),
    statusCode: Number.isFinite(statusCode) && statusCode > 0 ? statusCode : 0,
    payload: finding.payload || finding.attackPayload || "n/a",
    response: finding.response || finding.responseBody || "n/a",
    proof: finding.proof || finding.evidence || finding.description || "No proof provided",
    fix: finding.fix || finding.solution || finding.recommendation || "No fix provided",
    request: finding.request || finding.requestRaw || "n/a",
    timestamp: String(finding.timestamp || finding.createdAt || new Date().toISOString()),
    what: finding.description || finding.summary || "No description provided",
  };
}

function summarize(findings) {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings || []) {
    const severity = String(finding.severity || "info").toLowerCase();
    if (summary[severity] !== undefined) {
      summary[severity] += 1;
      continue;
    }
    summary.info += 1;
  }
  return summary;
}

function normalizeBrowserUseOps(operations = {}) {
  const browserUse = operations?.browserUse || {};
  const documentation = browserUse?.documentation || {};
  const coverage = documentation?.coverage || browserUse?.coverage || {};
  const llmHelpProbe = documentation?.llmHelpProbe || browserUse?.llmHelpProbe || null;

  return {
    coverage: {
      inputRoutes: Number(coverage?.inputRoutes || 0),
      uniqueRoutes: Number(coverage?.uniqueRoutes || 0),
      duplicatesSkipped: Number(coverage?.duplicatesSkipped || 0),
      uiPagesTested: Number(coverage?.uiPagesTested || 0),
      apiRoutesTested: Number(coverage?.apiRoutesTested || 0),
      authRoutesTested: Number(coverage?.authRoutesTested || 0),
      mappedUiElements: Number(coverage?.mappedUiElements || 0),
      brokenLinksDetected: Number(coverage?.brokenLinksDetected || 0),
    },
    instances: Array.isArray(documentation?.instances)
      ? documentation.instances
      : Array.isArray(browserUse?.instances)
        ? browserUse.instances
        : [],
    llmHelpProbe,
    documentation,
  };
}

function normalizeAiProbeFromOperations(operations = {}) {
  const probe = operations?.aiProbe || {};
  return {
    loading: false,
    lastRunAt: String(probe?.checkedAt || ""),
    ok: Boolean(probe?.ok),
    endpoint: String(probe?.endpoint || ""),
    status: Number(probe?.status || 0),
    detail: String(probe?.detail || ""),
  };
}

export const useScanStore = create((set, get) => ({
  lastScan: {
    started: "-",
    duration: "-",
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    browserUse: {
      coverage: {
        inputRoutes: 0,
        uniqueRoutes: 0,
        duplicatesSkipped: 0,
        uiPagesTested: 0,
        apiRoutesTested: 0,
        authRoutesTested: 0,
        mappedUiElements: 0,
        brokenLinksDetected: 0,
      },
      instances: [],
      llmHelpProbe: null,
      documentation: null,
    },
  },
  activityLog: [{ time: nowClock(), message: "Scan subsystem ready" }],
  scanTarget: "localhost:3000",
  scanMode: "Full Scan",
  scanProgress: {
    phase: "idle",
    phaseName: "idle",
    percent: 0,
  },
  modules: scannerModules,
  isScanRunning: false,
  findings: [],
  aiProbe: {
    loading: false,
    lastRunAt: "",
    ok: false,
    endpoint: "",
    status: 0,
    detail: "",
  },

  addLog: (message) => {
    set((state) => ({
      activityLog: [{ time: nowClock(), message }, ...state.activityLog].slice(0, 80),
    }));
  },

  setScanMode: (value) => set({ scanMode: value }),
  setScanTarget: (value) => set({ scanTarget: value }),

  toggleModule: (moduleId) => {
    set((state) => ({
      modules: state.modules.map((module) =>
        module.id === moduleId ? { ...module, enabled: !module.enabled } : module,
      ),
    }));
  },

  setProgressFromEvent: (payload = {}) => {
    const percent = Number(payload.percent || 0);
    const normalized = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
    set({
      isScanRunning: normalized < 100,
      scanProgress: {
        phase: payload.phase || "running",
        phaseName: payload.phaseName || payload.phase || "running",
        percent: normalized,
      },
    });
  },

  appendLiveFinding: (finding) => {
    set((state) => ({
      findings: [normalizeFinding(finding), ...state.findings].slice(0, 500),
    }));
  },

  hydrateStatus: async () => {
    const status = await window.dockium?.scan?.getStatus?.();
    if (!status?.ok) {
      return;
    }

    const phase = status?.status?.phase || "idle";
    if (phase !== "completed") {
      return;
    }

    const findingsResult = await window.dockium?.scan?.getFindings?.();
    const findings = (findingsResult?.findings || []).map(normalizeFinding);
    const summary = summarize(findings);
    const operations = status?.status?.operations || {};
    const browserUse = normalizeBrowserUseOps(operations);
    const aiProbe = normalizeAiProbeFromOperations(operations);

    set({
      findings,
      aiProbe,
      isScanRunning: false,
      scanProgress: { phase: "completed", phaseName: "completed", percent: 100 },
      lastScan: {
        started: status?.status?.completedAt
          ? new Date(status.status.completedAt).toLocaleString()
          : "-",
        duration: get().lastScan.duration,
        critical: summary.critical,
        high: summary.high,
        medium: summary.medium,
        low: summary.low,
        browserUse,
      },
    });
  },

  runScan: async (requestedMode = "full") => {
    const mode = requestedMode === "quick" ? "quick" : "full";
    get().addLog(`${mode === "quick" ? "Quick" : "Full"} scan started`);
    set({
      isScanRunning: true,
      scanProgress: { phase: mode, phaseName: "starting", percent: 5 },
      scanMode: mode === "quick" ? "Quick Scan" : "Full Scan",
    });

    try {
      const enabled = get().modules.filter((module) => module.enabled).map((module) => module.id);
      const response = await window.dockium?.scan?.start?.({
        mode,
        modules: enabled,
        targetUrl: get().scanTarget,
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Scan failed");
      }

      const scan = response.scan || {};
      const findings = (scan.findings || []).map(normalizeFinding);
      const summary = scan.summary || summarize(findings);
      const operations = scan.operations || {};
      const browserUse = normalizeBrowserUseOps(operations);
      const aiProbe = normalizeAiProbeFromOperations(operations);

      set({
        isScanRunning: false,
        findings,
        aiProbe,
        scanProgress: { phase: "completed", phaseName: "completed", percent: 100 },
        lastScan: {
          started: new Date(scan.completedAt || Date.now()).toLocaleString(),
          duration: toDuration(scan.durationMs || 0),
          critical: summary.critical || 0,
          high: summary.high || 0,
          medium: summary.medium || 0,
          low: summary.low || 0,
          browserUse,
        },
      });

      get().addLog(`Scan completed (${summary.total || findings.length} findings)`);
    } catch (error) {
      set({ isScanRunning: false, scanProgress: { phase: "error", phaseName: "error", percent: 0 } });
      get().addLog(`Scan error: ${error.message}`);
    }
  },

  runFullScan: async () => {
    await get().runScan("full");
  },

  runQuickScan: async () => {
    await get().runScan("quick");
  },

  testAiConnection: async () => {
    set((state) => ({
      aiProbe: {
        ...state.aiProbe,
        loading: true,
      },
    }));

    const response = await window.dockium?.scan?.testAiConnection?.();
    const probe = response?.probe || {};

    set({
      aiProbe: {
        loading: false,
        lastRunAt: new Date().toISOString(),
        ok: Boolean(response?.ok),
        endpoint: String(probe.endpoint || ""),
        status: Number(probe.status || 0),
        detail: String(probe.detail || response?.error || "No probe response"),
      },
    });

    get().addLog(
      response?.ok
        ? `AI probe passed (${probe.endpoint || "configured endpoint"})`
        : `AI probe failed: ${String(probe.detail || response?.error || "unknown")}`
    );
  },

  openInProxy: async () => {
    await window.dockium?.proxy?.start?.();
    set((state) => ({
      activityLog: [{ time: nowClock(), message: "Proxy started" }, ...state.activityLog].slice(0, 60),
    }));
  },

  exportReport: async () => {
    const result = await window.dockium?.report?.exportPdf?.();
    set((state) => ({
      activityLog: [
        {
          time: nowClock(),
          message: result?.ok ? `Report exported: ${result.filePath}` : "Report export canceled or failed",
        },
        ...state.activityLog,
      ].slice(0, 60),
    }));
  },

  viewReport: async () => {
    const latest = await window.dockium?.report?.getLatest?.();
    set((state) => ({
      activityLog: [
        {
          time: nowClock(),
          message: latest?.report ? "Loaded latest report metadata" : "No report available yet",
        },
        ...state.activityLog,
      ].slice(0, 60),
    }));
  },
}));
