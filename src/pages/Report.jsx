import React from "react";
import { useMapStore } from "../store/mapStore";
import { useNucleiStore } from "../store/nucleiStore";
import { useScanStore } from "../store/scanStore";
import { useFleetStore } from "../store/fleetStore";

const severityOrder = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const initialSections = {
  executive: true,
  appMap: true,
  findings: true,
  operations: true,
  screenshots: true,
  owasp: true,
  remediation: true,
};

function isScreenshotUrl(value) {
  const text = String(value || "").trim();
  return text.startsWith("data:image/") || /^https?:\/\//i.test(text);
}

function flattenFolderLines(node, depth = 0) {
  if (!node || typeof node !== "object") {
    return [];
  }

  const nodeType = String(node?.type || node?.kind || "folder").toLowerCase();
  const kind = nodeType === "file" ? "file" : "folder";
  const prefix = `${"  ".repeat(depth)}${kind === "folder" ? "+" : "-"}`;
  const current = `${prefix} ${String(node?.name || node?.path || "unknown")}`;
  const children = Array.isArray(node?.children) ? node.children : [];
  if (kind !== "folder" || children.length === 0) {
    return [current];
  }

  return [current, ...children.flatMap((child) => flattenFolderLines(child, depth + 1))];
}

function owaspStateClass(status) {
  if (status === "FAIL") return "report-state-fail";
  if (status === "PARTIAL") return "report-state-partial";
  return "report-state-pass";
}

function severityClass(severity) {
  return `scanner-severity-${severity}`;
}

function normalizeFinding(finding, index) {
  return {
    id: String(finding?.id || `finding-${index + 1}`),
    source: String(finding?.source || "scan"),
    severity: String(finding?.severity || "info").toLowerCase(),
    title: String(finding?.title || finding?.name || "Untitled finding"),
    endpoint: String(finding?.endpoint || finding?.url || "unknown"),
    description: String(finding?.description || finding?.what || "No description"),
    fix: String(finding?.fix || finding?.solution || "No suggested fix"),
  };
}

function summarizeSeverity(findings = []) {
  const summary = { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  findings.forEach((finding) => {
    const severity = String(finding?.severity || "info").toLowerCase();
    summary.total += 1;
    if (summary[severity] !== undefined) {
      summary[severity] += 1;
    } else {
      summary.info += 1;
    }
  });
  return summary;
}

function buildOwasp(findings = []) {
  const rules = [
    { id: "A01", label: "A01 Broken Access Control", test: /idor|access|privilege|auth bypass/i },
    { id: "A02", label: "A02 Cryptographic Failures", test: /crypto|cipher|tls|hash/i },
    { id: "A03", label: "A03 Injection", test: /sql|xss|command|injection/i },
    { id: "A04", label: "A04 Insecure Design", test: /design|trust boundary|workflow/i },
    { id: "A05", label: "A05 Security Misconfiguration", test: /header|config|debug|misconfiguration/i },
    { id: "A06", label: "A06 Vulnerable Components", test: /cve|dependency|component/i },
    { id: "A07", label: "A07 Auth Failures", test: /auth|jwt|session|token/i },
    { id: "A08", label: "A08 Data Integrity Failures", test: /integrity|tamper|checksum/i },
    { id: "A09", label: "A09 Logging Failures", test: /log|audit|monitor/i },
    { id: "A10", label: "A10 SSRF", test: /ssrf/i },
  ];

  return rules.map((rule) => {
    const matched = findings.filter((finding) => rule.test.test(`${finding.title} ${finding.description}`));
    if (matched.length === 0) {
      return { id: rule.id, label: rule.label, status: "PASS", detail: "0 findings" };
    }
    return {
      id: rule.id,
      label: rule.label,
      status: "FAIL",
      detail: `${matched.length} findings`,
    };
  });
}

function buildRemediation(findings = []) {
  return findings.slice(0, 12).map((finding) => ({
    done: false,
    text: `${finding.title} (${finding.severity.toUpperCase()}) @ ${finding.endpoint}`,
  }));
}

function Section({ id, title, isOpen, onToggle, children }) {
  return (
    <section className={isOpen ? "report-section open" : "report-section"}>
      <button className="report-section-toggle" onClick={() => onToggle(id)}>
        {isOpen ? "▼" : "▶"} {title}
      </button>
      {isOpen ? <div className="report-section-body">{children}</div> : null}
    </section>
  );
}

function buildMarkdownReport(payload) {
  const lines = [
    "# DOCKIUM Security Audit Report",
    "",
    `Scan: ${payload.scanStarted}`,
    `Duration: ${payload.duration}`,
    "",
    "## Executive Summary",
    payload.summary,
    "",
    "## Findings",
  ];

  payload.sortedFindings.forEach((finding) => {
    lines.push(`### [${finding.severity.toUpperCase()}] ${finding.title}`);
    lines.push(`- Source: ${finding.source}`);
    lines.push(`- Endpoint: ${finding.endpoint}`);
    lines.push(`- What happened: ${finding.description}`);
    lines.push(`- Fix: ${finding.fix}`);
    lines.push("");
  });

  lines.push("## OWASP Top 10 Checklist");
  payload.owasp.forEach((row) => lines.push(`- ${row.label}: ${row.status} (${row.detail})`));
  lines.push("");

  lines.push("## Remediation Checklist");
  payload.remediation.forEach((item) => lines.push(`- [${item.done ? "x" : " "}] ${item.text}`));
  lines.push("");

  lines.push("## Browser Screenshots");
  if (Array.isArray(payload.screenshots) && payload.screenshots.length > 0) {
    payload.screenshots.forEach((item) => {
      lines.push(`- ${item.role} (${item.status})`);
      lines.push(`  - URL: ${item.url || "n/a"}`);
      lines.push(`  - Context: ${item.context || "--"}`);
    });
  } else {
    lines.push("- No screenshots available");
  }
  lines.push("");

  return lines.join("\n");
}

function buildLocalFallbackContext(projectInfo, folderTree, routes, scanFindings, nucleiStatus, nucleiFindings) {
  const findings = [
    ...(Array.isArray(scanFindings) ? scanFindings : []),
    ...(Array.isArray(nucleiFindings) ? nucleiFindings : []),
  ].map(normalizeFinding);

  return {
    generatedAt: new Date().toISOString(),
    project: {
      name: String(projectInfo?.name || "local-context"),
      framework: String(projectInfo?.framework || ""),
      targetUrl: String(projectInfo?.targetUrl || ""),
      projectPath: String(projectInfo?.projectPath || ""),
    },
    appMap: {
      routeCount: Array.isArray(routes) ? routes.length : 0,
      folderTree: folderTree || null,
      routes: Array.isArray(routes) ? routes : [],
      warnings: [],
      openApiSummary: "",
    },
    scan: {
      mode: "local",
      durationMs: 0,
      completedAt: String(nucleiStatus?.completedAt || ""),
      findingsCount: findings.length,
      summary: summarizeSeverity(findings),
    },
    artemis: {
      status: nucleiStatus || null,
      findingsCount: Array.isArray(nucleiFindings) ? nucleiFindings.length : 0,
      findings: Array.isArray(nucleiFindings) ? nucleiFindings : [],
      checksRun: 0,
      endpointCount: 0,
    },
    browserUse: {
      coverage: {
        inputRoutes: 0,
        uniqueRoutes: 0,
        duplicatesSkipped: 0,
        uiPagesTested: 0,
        apiRoutesTested: 0,
        authRoutesTested: 0,
      },
      documentation: null,
      llmHelpProbe: null,
      instances: [],
    },
    nuclei: {
      status: nucleiStatus || null,
      findingsCount: Array.isArray(nucleiFindings) ? nucleiFindings.length : 0,
      findings: Array.isArray(nucleiFindings) ? nucleiFindings : [],
    },
    proxy: {
      status: { running: false },
      requestCount: 0,
      recentRequests: [],
    },
    git: {
      gateRules: {},
      pushHistory: [],
    },
    docker: {
      containers: [],
    },
    findings,
    summary: summarizeSeverity(findings),
    latestReport: null,
  };
}

export default function Report() {
  const mapFolderTree = useMapStore((state) => state.folderTree);
  const mapRoutes = useMapStore((state) => state.routes);
  const scanFindings = useScanStore((state) => state.findings);
  const nucleiStatus = useNucleiStore((state) => state.status);
  const nucleiFindings = useNucleiStore((state) => state.findings);
  const fleetSessions = useFleetStore((state) => state.sessions);

  const [sections, setSections] = React.useState(initialSections);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [context, setContext] = React.useState(null);
  const [aiSummary, setAiSummary] = React.useState("");
  const [aiStatus, setAiStatus] = React.useState("AI summary idle");
  const [exportStatus, setExportStatus] = React.useState("Ready");
  const [projectInfo, setProjectInfo] = React.useState(null);
  const [llmEnabled, setLlmEnabled] = React.useState(false);
  const autoSummaryStartedRef = React.useRef(false);

  React.useEffect(() => {
    let mounted = true;
    const hydrateProject = async () => {
      const response = await window.dockium?.project?.getInfo?.();
      if (!mounted) {
        return;
      }
      setProjectInfo(response?.ok ? response.projectInfo || null : null);
    };
    hydrateProject();
    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    let mounted = true;
    const hydrateSettings = async () => {
      const settings = await window.dockium?.settingsGetAll?.();
      if (!mounted) {
        return;
      }
      setLlmEnabled(settings?.reportLlmEnabled === true);
    };
    hydrateSettings();
    return () => {
      mounted = false;
    };
  }, []);

  const localFallbackContext = React.useMemo(
    () => buildLocalFallbackContext(projectInfo, mapFolderTree, mapRoutes, scanFindings, nucleiStatus, nucleiFindings),
    [mapFolderTree, mapRoutes, nucleiFindings, nucleiStatus, projectInfo, scanFindings],
  );

  const refreshContext = React.useCallback(async () => {
    setLoading(true);
    setLoadError("");

    const getContextApi = window.dockium?.report?.getContext;
    if (typeof getContextApi !== "function") {
      setContext(localFallbackContext);
      setLoading(false);
      return;
    }

    try {
      const response = await getContextApi();
      if (response?.ok && response.context) {
        setContext(response.context || null);
      } else {
        const latest = await window.dockium?.report?.getLatest?.();
        if (latest?.ok && latest?.report) {
          setContext({
            ...localFallbackContext,
            latestReport: latest.report,
            findings: Array.isArray(latest.report.findings)
              ? latest.report.findings.map(normalizeFinding)
              : localFallbackContext.findings,
          });
        } else {
          setContext(localFallbackContext);
        }
      }
    } catch (error) {
      setContext(localFallbackContext);
      setLoadError("");
    } finally {
      setLoading(false);
    }
  }, [localFallbackContext]);

  React.useEffect(() => {
    refreshContext();
  }, [refreshContext]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      refreshContext();
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshContext]);

  const projectName = String(context?.project?.name || "-");
  const scanStarted = String(context?.scan?.completedAt || "-");
  const duration = Number(context?.scan?.durationMs || 0);
  const durationText = duration > 0 ? `${Math.round(duration / 1000)}s` : "-";

  const folderLines = React.useMemo(
    () => flattenFolderLines(context?.appMap?.folderTree),
    [context?.appMap?.folderTree],
  );
  const routeLines = React.useMemo(
    () => (context?.appMap?.routes || []).map((route) => {
      const authRequired = route?.authRequired ? "yes" : "no";
      return `${String(route?.method || "GET").padEnd(6, " ")} ${route?.path || "/"} | auth:${authRequired} | ${route?.sourceFile || "unknown"}`;
    }),
    [context?.appMap?.routes],
  );

  const sortedFindings = React.useMemo(() => {
    const normalized = (context?.findings || []).map(normalizeFinding);
    return normalized.sort((a, b) => {
      const aRank = severityOrder[a.severity] ?? 99;
      const bRank = severityOrder[b.severity] ?? 99;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      return a.title.localeCompare(b.title);
    });
  }, [context?.findings]);

  const summary = React.useMemo(() => summarizeSeverity(sortedFindings), [sortedFindings]);

  const browserUseCoverage = React.useMemo(() => {
    const reportOps = context?.latestReport?.operations?.browserUse;
    const contextCoverage = context?.browserUse?.coverage;
    const coverage = contextCoverage || reportOps || {};

    return {
      uniqueRoutes: Number(coverage?.uniqueRoutes || 0),
      uiPagesTested: Number(coverage?.uiPagesTested || 0),
      apiRoutesTested: Number(coverage?.apiRoutesTested || 0),
      authRoutesTested: Number(coverage?.authRoutesTested || 0),
      isolatedInstanceCount: Number(coverage?.isolatedInstanceCount || coverage?.instances?.length || 0),
      llmHelpProbe: context?.browserUse?.llmHelpProbe || reportOps?.llmHelpProbe || null,
      documentation: context?.browserUse?.documentation || reportOps?.documentation || null,
    };
  }, [
    context?.browserUse?.coverage,
    context?.browserUse?.documentation,
    context?.browserUse?.llmHelpProbe,
    context?.latestReport?.operations?.browserUse,
  ]);

  const scannerAiProbe = React.useMemo(
    () => context?.scan?.operations?.aiProbe || context?.latestReport?.operations?.aiProbe || null,
    [context?.latestReport?.operations?.aiProbe, context?.scan?.operations?.aiProbe],
  );

  const browserUseAuthWorkflow = React.useMemo(() => {
    const fromDoc = Array.isArray(context?.browserUse?.documentation?.instances)
      ? context.browserUse.documentation.instances
      : [];
    const fromOps = Array.isArray(context?.latestReport?.operations?.browserUse?.documentation?.instances)
      ? context.latestReport.operations.browserUse.documentation.instances
      : [];
    const instances = fromDoc.length > 0 ? fromDoc : fromOps;
    const authRunner = instances.find((entry) => String(entry?.kind || "") === "auth-route");
    return authRunner?.workflow || null;
  }, [
    context?.browserUse?.documentation?.instances,
    context?.latestReport?.operations?.browserUse?.documentation?.instances,
  ]);

  const proxyOps = React.useMemo(() => {
    const proxy = context?.proxy || {};
    const status = proxy?.status || {};
    const summary = proxy?.summary || {};
    const recentRequests = Array.isArray(proxy?.recentRequests) ? proxy.recentRequests : [];

    return {
      running: Boolean(status?.running),
      port: Number(status?.port || 8080),
      requestCount: Number(proxy?.requestCount || status?.requestCount || recentRequests.length || 0),
      summary,
      recentRequests,
    };
  }, [context?.proxy]);

  const proxyEvidencePreview = React.useMemo(
    () => proxyOps.recentRequests
      .slice(-16)
      .reverse()
      .map((entry) => ({
        id: Number(entry?.id || 0),
        method: String(entry?.method || "GET").toUpperCase(),
        path: String(entry?.path || "/"),
        status: Number(entry?.status || entry?.responseStatus || 0),
        flag: String(entry?.flag || "normal"),
        requestRaw: String(entry?.requestRaw || entry?.requestBody || ""),
        responseRaw: String(entry?.responseRaw || entry?.responseBody || ""),
      })),
    [proxyOps.recentRequests],
  );

  const summaryText = React.useMemo(
    () => `Total findings: ${summary.total} (${summary.critical} critical, ${summary.high} high, ${summary.medium} medium, ${summary.low} low, ${summary.info} info). App routes mapped: ${routeLines.length}. Browser-use tested ${browserUseCoverage.uniqueRoutes} unique routes across ${browserUseCoverage.isolatedInstanceCount} isolated instances (pages ${browserUseCoverage.uiPagesTested}, api ${browserUseCoverage.apiRoutesTested}, auth ${browserUseCoverage.authRoutesTested}). Proxy requests captured: ${Number(context?.proxy?.requestCount || 0)}.`,
    [
      browserUseCoverage.apiRoutesTested,
      browserUseCoverage.authRoutesTested,
      browserUseCoverage.isolatedInstanceCount,
      browserUseCoverage.uiPagesTested,
      browserUseCoverage.uniqueRoutes,
      context?.proxy?.requestCount,
      routeLines.length,
      summary,
    ],
  );

  const owaspChecklist = React.useMemo(() => {
    if (Array.isArray(context?.latestReport?.owaspChecklist) && context.latestReport.owaspChecklist.length > 0) {
      return context.latestReport.owaspChecklist;
    }
    return buildOwasp(sortedFindings);
  }, [context?.latestReport?.owaspChecklist, sortedFindings]);

  const remediationChecklist = React.useMemo(() => {
    if (Array.isArray(context?.latestReport?.remediationChecklist) && context.latestReport.remediationChecklist.length > 0) {
      return context.latestReport.remediationChecklist;
    }
    return buildRemediation(sortedFindings);
  }, [context?.latestReport?.remediationChecklist, sortedFindings]);

  const reportScreenshots = React.useMemo(
    () => (Array.isArray(fleetSessions) ? fleetSessions : [])
      .filter((session) => isScreenshotUrl(session?.previewUrl))
      .slice(0, 12)
      .map((session) => ({
        id: String(session?.id || session?.role || Math.random()),
        role: String(session?.role || session?.id || "SESSION"),
        status: String(session?.status || "--"),
        context: String(session?.current || session?.last || "--"),
        url: String(session?.previewUrl || ""),
      })),
    [fleetSessions],
  );

  const exportPayload = React.useMemo(
    () => ({
      projectName,
      scanStarted,
      duration: durationText,
      summary: summaryText,
      sortedFindings,
      owasp: owaspChecklist,
      remediation: remediationChecklist,
      appMap: {
        folders: folderLines,
        routes: routeLines,
      },
      modules: {
        artemis: {
          findingsCount: Number(context?.artemis?.findingsCount || context?.nuclei?.findingsCount || 0),
          status: context?.artemis?.status || context?.nuclei?.status || null,
          checksRun: Number(context?.artemis?.checksRun || 0),
          endpointCount: Number(context?.artemis?.endpointCount || 0),
        },
        browserUse: browserUseCoverage,
        proxy: context?.proxy || null,
        git: context?.git || null,
        docker: context?.docker || null,
      },
      screenshots: reportScreenshots,
      aiSummary,
    }),
    [
      aiSummary,
      context?.docker,
      context?.git,
      context?.artemis?.checksRun,
      context?.artemis?.endpointCount,
      context?.artemis?.findingsCount,
      context?.artemis?.status,
      context?.nuclei?.findingsCount,
      context?.nuclei?.status,
      context?.proxy,
      browserUseCoverage,
      durationText,
      folderLines,
      owaspChecklist,
      projectName,
      reportScreenshots,
      remediationChecklist,
      routeLines,
      scanStarted,
      sortedFindings,
      summaryText,
    ],
  );

  const toggleSection = (id) => {
    setSections((current) => ({ ...current, [id]: !current[id] }));
  };

  const handleExport = async (format) => {
    const reportApi = window.dockium?.report;
    if (!reportApi) {
      setExportStatus("Export failed: desktop IPC bridge unavailable");
      return;
    }

    setExportStatus(`Exporting ${format.toUpperCase()}...`);

    let result = null;
    if (format === "pdf") {
      result = await reportApi.exportPdf?.();
    } else if (format === "markdown") {
      result = await reportApi.exportMarkdown?.({
        content: buildMarkdownReport(exportPayload),
      });
    } else if (format === "json") {
      result = await reportApi.exportJson?.({
        content: JSON.stringify(exportPayload, null, 2),
      });
    } else {
      result = { ok: false, error: `Unsupported export format: ${format}` };
    }

    if (result?.ok) {
      setExportStatus(`Exported to ${result.filePath}`);
      return;
    }

    if (result?.canceled) {
      setExportStatus("Export canceled");
      return;
    }

    setExportStatus(`Export failed: ${result?.error ?? "Unknown error"}`);
  };

  const generateAiSummary = React.useCallback(async () => {
    if (!window.dockium?.report?.generateSummary) {
      setAiStatus("AI summary unavailable: IPC bridge missing");
      return;
    }

    setAiStatus("Generating AI summary...");
    const result = await window.dockium.report.generateSummary();
    if (!result?.ok) {
      setAiStatus(`AI summary failed: ${result?.error || "Unknown error"}`);
      return;
    }

    setAiSummary(String(result.summary || ""));
    setAiStatus(`AI summary generated (${result?.meta?.model || "model"})`);
  }, []);

  React.useEffect(() => {
    if (loading || autoSummaryStartedRef.current) {
      return;
    }

    if (!context || sortedFindings.length === 0) {
      autoSummaryStartedRef.current = true;
      return;
    }

    if (!llmEnabled) {
      autoSummaryStartedRef.current = true;
      return;
    }

    autoSummaryStartedRef.current = true;
    generateAiSummary().catch((error) => {
      setAiStatus(`AI summary failed: ${String(error?.message || "Unknown error")}`);
    });
  }, [context, generateAiSummary, llmEnabled, loading, sortedFindings.length]);

  if (loading) {
    return <section className="report-view"><div className="report-status">Loading report context...</div></section>;
  }

  if (loadError) {
    return (
      <section className="report-view">
        <div className="report-status">{loadError}</div>
        <button className="report-export-btn" onClick={refreshContext}>Retry</button>
      </section>
    );
  }

  return (
    <section className="report-view">
      <header className="report-toolbar">
        <div className="report-toolbar-meta">
          <span>Project: {projectName}</span>
          <span>Scan Completed: {scanStarted}</span>
          <span>Duration: {durationText}</span>
        </div>
        <div className="report-toolbar-actions">
          <button className="report-export-btn" onClick={refreshContext}>Refresh</button>
          <button className="report-export-btn" onClick={generateAiSummary}>Generate AI Summary</button>
          <button className="report-export-btn" onClick={() => handleExport("pdf")}>Export PDF</button>
          <button className="report-export-btn" onClick={() => handleExport("markdown")}>Export Markdown</button>
          <button className="report-export-btn" onClick={() => handleExport("json")}>Export JSON</button>
        </div>
      </header>

      <div className="report-status">{exportStatus}</div>
      <div className="report-status">{aiStatus}</div>

      <div className="report-document">
        <Section id="executive" title="EXECUTIVE SUMMARY" isOpen={sections.executive} onToggle={toggleSection}>
          <p>{summaryText}</p>
          {aiSummary ? <pre>{aiSummary}</pre> : <p>Generate AI summary to get risk-prioritized recommendations from full app context.</p>}
        </Section>

        <Section id="appMap" title="APPLICATION MAP" isOpen={sections.appMap} onToggle={toggleSection}>
          <div className="report-map-grid">
            <div className="report-map-block">
              <h4>Folder Tree</h4>
              <pre>{folderLines.length > 0 ? folderLines.join("\n") : "No folder tree captured yet."}</pre>
            </div>
            <div className="report-map-block">
              <h4>Route Tree</h4>
              <pre>{routeLines.length > 0 ? routeLines.join("\n") : "No routes captured yet."}</pre>
            </div>
          </div>
          <p>OpenAPI: {context?.appMap?.openApiSummary || "No OpenAPI summary"}</p>
          <p>Warnings: {(context?.appMap?.warnings || []).join(" | ") || "None"}</p>
        </Section>

        <Section id="findings" title="FINDINGS" isOpen={sections.findings} onToggle={toggleSection}>
          <div className="report-findings-list">
            {sortedFindings.length === 0 ? <div className="scanner-empty">No findings in current context.</div> : null}
            {sortedFindings.map((finding) => (
              <article key={finding.id} className="report-finding-block">
                <header className="report-finding-head">
                  <span className={`report-severity ${severityClass(finding.severity)}`}>
                    [{finding.severity.toUpperCase()}]
                  </span>
                  <span>{finding.title} ({finding.source})</span>
                </header>
                <p>Endpoint: {finding.endpoint}</p>
                <p>What happened:</p>
                <pre>{finding.description}</pre>
                <p>Fix:</p>
                <pre>{finding.fix}</pre>
              </article>
            ))}
          </div>
        </Section>

        <Section id="operations" title="OPERATIONS SNAPSHOT" isOpen={sections.operations} onToggle={toggleSection}>
          <div className="report-map-grid">
            <div className="report-map-block">
              <h4>Artemis Active Scanner</h4>
              <pre>{JSON.stringify(context?.artemis || context?.nuclei || {}, null, 2)}</pre>
            </div>
            <div className="report-map-block">
              <h4>Browser UI/Route Testing</h4>
              <pre>{JSON.stringify(browserUseCoverage, null, 2)}</pre>
            </div>
            <div className="report-map-block">
              <h4>Auth Workflow</h4>
              <pre>{JSON.stringify(browserUseAuthWorkflow || {}, null, 2)}</pre>
            </div>
            <div className="report-map-block">
              <h4>Scanner AI Probe</h4>
              <pre>{JSON.stringify(scannerAiProbe || {}, null, 2)}</pre>
            </div>
            <div className="report-map-block">
              <h4>Proxy/Git/Docker</h4>
              <pre>{JSON.stringify({ proxy: context?.proxy, git: context?.git, docker: context?.docker }, null, 2)}</pre>
            </div>
          </div>
          <div className="report-map-grid">
            <div className="report-map-block">
              <h4>Proxy Traffic Summary</h4>
              <pre>{JSON.stringify({
                running: proxyOps.running,
                port: proxyOps.port,
                requestCount: proxyOps.requestCount,
                summary: proxyOps.summary,
              }, null, 2)}</pre>
            </div>
          </div>
          <div className="report-proxy-evidence-list">
            {proxyEvidencePreview.length === 0 ? (
              <div className="scanner-empty">No proxy request/response evidence captured yet.</div>
            ) : (
              proxyEvidencePreview.map((entry) => (
                <article key={`${entry.id}-${entry.method}-${entry.path}`} className="report-proxy-evidence-card">
                  <header className="report-proxy-evidence-head">
                    <strong>{entry.method} {entry.path}</strong>
                    <span>[{entry.status}] {entry.flag}</span>
                  </header>
                  <div className="report-map-grid">
                    <div className="report-map-block">
                      <h4>Request</h4>
                      <pre>{entry.requestRaw || "n/a"}</pre>
                    </div>
                    <div className="report-map-block">
                      <h4>Response</h4>
                      <pre>{entry.responseRaw || "n/a"}</pre>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
          <div className="report-map-grid">
            <div className="report-map-block">
              <h4>Browser Test Documentation</h4>
              <pre>{JSON.stringify(browserUseCoverage.documentation || {}, null, 2)}</pre>
            </div>
          </div>
        </Section>

        <Section id="screenshots" title="BROWSER SCREENSHOTS" isOpen={sections.screenshots} onToggle={toggleSection}>
          {reportScreenshots.length === 0 ? (
            <div className="scanner-empty">No screenshots available yet. Start Chromium Fleet and run scan/login flows to collect evidence frames.</div>
          ) : (
            <div className="report-screenshot-grid">
              {reportScreenshots.map((shot) => (
                <article key={shot.id} className="report-screenshot-card">
                  <header className="report-screenshot-head">
                    <strong>{shot.role}</strong>
                    <span>{shot.status}</span>
                  </header>
                  <img className="report-screenshot-image" src={shot.url} alt={`${shot.role} screenshot`} loading="lazy" />
                  <p className="report-screenshot-context">{shot.context}</p>
                </article>
              ))}
            </div>
          )}
        </Section>

        <Section id="owasp" title="OWASP TOP 10 CHECKLIST" isOpen={sections.owasp} onToggle={toggleSection}>
          <div className="report-owasp-list">
            {owaspChecklist.map((item) => (
              <div key={item.id} className="report-owasp-row">
                <span>{item.label}</span>
                <span className={owaspStateClass(item.status)}>
                  [{item.status} - {item.detail}]
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="remediation"
          title="REMEDIATION CHECKLIST"
          isOpen={sections.remediation}
          onToggle={toggleSection}
        >
          <ul className="report-remediation-list">
            {remediationChecklist.map((item) => (
              <li key={item.text}>{item.done ? "[x]" : "[ ]"} {item.text}</li>
            ))}
          </ul>
        </Section>
      </div>
    </section>
  );
}
