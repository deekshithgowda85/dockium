const fs = require("node:fs/promises");

function defaultExportName(extension) {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `dockium-report-${stamp}.${extension}`;
}

function fail(error, code = 500, detail = "") {
  return {
    ok: false,
    error: String(error || "Request failed"),
    code: Number(code || 500),
    detail: String(detail || ""),
  };
}

function clipText(value, maxLength = 2000) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 3))}...`;
}

function normalizeProxyEvidence(request, index) {
  return {
    id: Number(request?.id || index + 1),
    timestamp: String(request?.timestamp || ""),
    method: String(request?.method || "GET").toUpperCase(),
    host: String(request?.host || ""),
    path: String(request?.path || "/"),
    status: Number(request?.status || request?.responseStatus || 0),
    flag: String(request?.flag || "normal"),
    durationMs: Number(request?.durationMs || request?.timeMs || 0),
    requestFormat: String(request?.requestFormat || "unknown"),
    responseFormat: String(request?.responseFormat || "unknown"),
    requestBytes: Number(request?.requestBytes || 0),
    responseBytes: Number(request?.responseBytes || 0),
    requestRaw: clipText(request?.requestRaw || request?.requestBody || "", 2500),
    responseRaw: clipText(request?.responseRaw || request?.responseBody || "", 2500),
  };
}

function normalizeFinding(item, index) {
  return {
    id: String(item?.id || `context-${index + 1}`),
    severity: String(item?.severity || "info").toLowerCase(),
    title: String(item?.title || item?.name || "Untitled finding"),
    endpoint: String(item?.endpoint || item?.url || "unknown"),
    description: String(item?.description || item?.what || ""),
    fix: String(item?.fix || item?.solution || ""),
    source: String(item?.source || "context"),
    engine: String(item?.engine || item?.source || "context"),
  };
}

function summarizeFindings(findings = []) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let weightedRisk = 0;

  for (const finding of findings) {
    const severity = String(finding?.severity || "info").toLowerCase();
    if (bySeverity[severity] !== undefined) {
      bySeverity[severity] += 1;
    } else {
      bySeverity.info += 1;
    }

    if (severity === "critical") weightedRisk += 10;
    else if (severity === "high") weightedRisk += 7;
    else if (severity === "medium") weightedRisk += 4;
    else if (severity === "low") weightedRisk += 2;
    else weightedRisk += 1;
  }

  return {
    total: findings.length,
    bySeverity,
    weightedRisk: Number(weightedRisk.toFixed(1)),
    avgRisk: findings.length > 0 ? Number((weightedRisk / findings.length).toFixed(2)) : 0,
  };
}

function buildReportFromContext(context = {}) {
  const findings = Array.isArray(context?.findings)
    ? context.findings.map(normalizeFinding)
    : [];
  const summary = summarizeFindings(findings);

  const proxyRecent = Array.isArray(context?.proxy?.recentRequests)
    ? context.proxy.recentRequests.map(normalizeProxyEvidence)
    : [];

  return {
    meta: {
      timestamp: String(context?.generatedAt || new Date().toISOString()),
      duration: Number(context?.scan?.durationMs || 0),
      projectName: String(context?.project?.name || "dockium"),
      framework: String(context?.project?.framework || "unknown"),
      scanMode: String(context?.scan?.mode || "context"),
      primaryEngine: "context",
    },
    summary,
    operations: {
      artemis: context?.artemis || null,
      browserUse: {
        ...(context?.browserUse?.coverage || {}),
        llmHelpProbe: context?.browserUse?.llmHelpProbe || null,
      },
      aiProbe: context?.scan?.operations?.aiProbe || null,
      proxy: {
        ...(context?.proxy?.summary || {}),
        running: Boolean(context?.proxy?.status?.running),
        port: Number(context?.proxy?.status?.port || 8080),
        requestCount: Number(context?.proxy?.requestCount || proxyRecent.length),
        recentRequests: proxyRecent,
      },
      git: context?.git || null,
      docker: context?.docker || null,
    },
    findings,
    owaspChecklist: Array.isArray(context?.latestReport?.owaspChecklist) ? context.latestReport.owaspChecklist : [],
    remediationChecklist: Array.isArray(context?.latestReport?.remediationChecklist) ? context.latestReport.remediationChecklist : [],
    appMap: {
      folderTree: context?.appMap?.folderTree || null,
      routeTree: Array.isArray(context?.appMap?.routes) ? context.appMap.routes : [],
      apiGraph: [],
    },
    evidence: {
      proxyRecentRequests: proxyRecent,
    },
  };
}

function mergeContextIntoReport(baseReport = {}, context = {}) {
  const report = { ...(baseReport || {}) };
  const proxyRecent = Array.isArray(context?.proxy?.recentRequests)
    ? context.proxy.recentRequests.map(normalizeProxyEvidence)
    : [];

  report.operations = {
    ...(report.operations || {}),
    browserUse: {
      ...(report.operations?.browserUse || {}),
      ...(context?.browserUse?.coverage || {}),
      llmHelpProbe: context?.browserUse?.llmHelpProbe || report.operations?.browserUse?.llmHelpProbe || null,
      documentation: context?.browserUse?.documentation || report.operations?.browserUse?.documentation || null,
    },
    aiProbe: context?.scan?.operations?.aiProbe || report.operations?.aiProbe || null,
    proxy: {
      ...(report.operations?.proxy || {}),
      ...(context?.proxy?.summary || {}),
      running: Boolean(context?.proxy?.status?.running),
      port: Number(context?.proxy?.status?.port || 8080),
      requestCount: Number(context?.proxy?.requestCount || proxyRecent.length),
      recentRequests: proxyRecent,
    },
    git: context?.git || report.operations?.git || null,
    docker: context?.docker || report.operations?.docker || null,
  };

  report.evidence = {
    ...(report.evidence || {}),
    proxyRecentRequests: proxyRecent,
  };

  if (!report.meta || typeof report.meta !== "object") {
    report.meta = {};
  }
  report.meta.projectName = report.meta.projectName || String(context?.project?.name || "dockium");
  report.meta.framework = report.meta.framework || String(context?.project?.framework || "unknown");
  report.meta.timestamp = report.meta.timestamp || String(context?.generatedAt || new Date().toISOString());

  return report;
}

async function resolveReportForExport(getReport, getReportContext) {
  const baseReport = getReport() || null;
  let context = null;

  try {
    context = await getReportContext();
  } catch {
    context = null;
  }

  if (baseReport && context) {
    return mergeContextIntoReport(baseReport, context);
  }
  if (baseReport) {
    return baseReport;
  }
  if (context) {
    return buildReportFromContext(context);
  }

  return null;
}

function registerReportIpc(ipcMain, BrowserWindow, dialog, deps) {
  const getReport = () => deps.getLatestReport() || null;
  const getReportContext = async () => {
    if (typeof deps.getReportContext !== "function") {
      return null;
    }
    return await deps.getReportContext();
  };
  const exporters = deps.exporters || {};

  ipcMain.handle("report:getLatest", async () => {
    return { ok: true, report: getReport() };
  });

  ipcMain.handle("report:getContext", async () => {
    try {
      const context = await getReportContext();
      return { ok: true, context: context || {} };
    } catch (error) {
      return fail(
        "Failed to build report context",
        500,
        String(error?.message || "report:getContext handler exception")
      );
    }
  });

  ipcMain.handle("report:generateSummary", async (_event, payload = {}) => {
    if (typeof deps.generateLlmSummary !== "function") {
      return {
        ok: false,
        error: "LLM summary integration is not configured",
        code: 503,
        detail: "report:generateSummary handler unavailable",
      };
    }

    try {
      const result = await deps.generateLlmSummary(payload);
      if (result?.ok === false) {
        return fail(result.error || "AI summary generation failed", result.code || 500, result.detail || "");
      }
      return result;
    } catch (error) {
      return fail("AI summary generation failed", 500, String(error?.message || "Unhandled LLM summary error"));
    }
  });

  ipcMain.handle("report:exportPdf", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { ok: false, error: "No active window for export" };
    }

    const save = await dialog.showSaveDialog(senderWindow, {
      title: "Export Security Report (PDF)",
      defaultPath: defaultExportName("pdf"),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (save.canceled || !save.filePath) {
      return { ok: false, canceled: true };
    }

    const report = await resolveReportForExport(getReport, getReportContext);
    if (!report) {
      return { ok: false, error: "No report available" };
    }

    const PdfExporter = exporters.pdf;
    if (PdfExporter) {
      const exporter = new PdfExporter();
      await exporter.export(report, save.filePath);
    } else {
      const pdfBuffer = await senderWindow.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
      await fs.writeFile(save.filePath, pdfBuffer);
    }

    return { ok: true, filePath: save.filePath };
  });

  ipcMain.handle("report:exportMarkdown", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { ok: false, error: "No active window for export" };
    }

    const report = await resolveReportForExport(getReport, getReportContext);
    if (!report) {
      return { ok: false, error: "No report available" };
    }

    const save = await dialog.showSaveDialog(senderWindow, {
      title: "Export Security Report (Markdown)",
      defaultPath: defaultExportName("md"),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });

    if (save.canceled || !save.filePath) {
      return { ok: false, canceled: true };
    }

    const MarkdownExporter = exporters.markdown;
    if (MarkdownExporter) {
      const exporter = new MarkdownExporter();
      await exporter.export(report, save.filePath);
    } else {
      await fs.writeFile(save.filePath, JSON.stringify(report, null, 2), "utf8");
    }

    return { ok: true, filePath: save.filePath };
  });

  ipcMain.handle("report:exportJson", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { ok: false, error: "No active window for export" };
    }

    const report = await resolveReportForExport(getReport, getReportContext);
    if (!report) {
      return { ok: false, error: "No report available" };
    }

    const save = await dialog.showSaveDialog(senderWindow, {
      title: "Export Security Report (JSON)",
      defaultPath: defaultExportName("json"),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (save.canceled || !save.filePath) {
      return { ok: false, canceled: true };
    }

    const JsonExporter = exporters.json;
    if (JsonExporter) {
      const exporter = new JsonExporter();
      await exporter.export(report, save.filePath);
    } else {
      await fs.writeFile(save.filePath, JSON.stringify(report, null, 2), "utf8");
    }

    return { ok: true, filePath: save.filePath };
  });
}

module.exports = { registerReportIpc };
