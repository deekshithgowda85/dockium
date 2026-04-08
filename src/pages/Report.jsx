import React from "react";

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
  owasp: true,
  remediation: true,
};

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

  return lines.join("\n");
}

export default function Report() {
  const [sections, setSections] = React.useState(initialSections);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [context, setContext] = React.useState(null);
  const [aiSummary, setAiSummary] = React.useState("");
  const [aiStatus, setAiStatus] = React.useState("AI summary idle");
  const [exportStatus, setExportStatus] = React.useState("Ready");

  const refreshContext = React.useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await window.dockium?.report?.getContext?.();
      if (!response?.ok) {
        setLoadError(String(response?.error || "Failed to load report context"));
        setContext(null);
      } else {
        setContext(response.context || null);
      }
    } catch (error) {
      setLoadError(String(error?.message || "Failed to load report context"));
      setContext(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refreshContext();
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

  const summaryText = React.useMemo(
    () => `Total findings: ${summary.total} (${summary.critical} critical, ${summary.high} high, ${summary.medium} medium, ${summary.low} low, ${summary.info} info). App routes mapped: ${routeLines.length}. Proxy requests captured: ${Number(context?.proxy?.requestCount || 0)}.`,
    [context?.proxy?.requestCount, routeLines.length, summary],
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
        nuclei: {
          findingsCount: Number(context?.nuclei?.findingsCount || 0),
          status: context?.nuclei?.status || null,
        },
        proxy: context?.proxy || null,
        git: context?.git || null,
        docker: context?.docker || null,
      },
      aiSummary,
    }),
    [
      aiSummary,
      context?.docker,
      context?.git,
      context?.nuclei?.findingsCount,
      context?.nuclei?.status,
      context?.proxy,
      durationText,
      folderLines,
      owaspChecklist,
      projectName,
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
    const exportApi = window.dockium?.exportReport;
    if (!exportApi) {
      setExportStatus("Export failed: desktop IPC bridge unavailable");
      return;
    }

    setExportStatus(`Exporting ${format.toUpperCase()}...`);

    const content =
      format === "markdown"
        ? buildMarkdownReport(exportPayload)
        : format === "json"
          ? JSON.stringify(exportPayload, null, 2)
          : "";

    const result = await exportApi({ format, content });
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

  const generateAiSummary = async () => {
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
  };

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
              <h4>Nuclei</h4>
              <pre>{JSON.stringify(context?.nuclei?.status || {}, null, 2)}</pre>
            </div>
            <div className="report-map-block">
              <h4>Proxy/Git/Docker</h4>
              <pre>{JSON.stringify({ proxy: context?.proxy, git: context?.git, docker: context?.docker }, null, 2)}</pre>
            </div>
          </div>
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
