import React from "react";
import { useMapStore } from "../store/mapStore";
import { useScanStore } from "../store/scanStore";

const severityOrder = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const findings = [
  {
    id: "f-sqli",
    severity: "critical",
    title: "SQL Injection",
    endpoint: "POST /api/search",
    file: "src/app/api/search/route.ts:34",
    happened:
      "Unsanitized user input was interpolated directly into a SQL query. Attacker can extract all data from the database.",
    proof:
      "POST /api/search\n{ 'q': \"' OR 1=1 --\" }\nResponse: 200 (returned all 847 database rows)",
    fix:
      "Replace string interpolation with parameterized query:\ndb.query('SELECT * FROM posts WHERE title LIKE ?', [q])",
  },
  {
    id: "f-idor",
    severity: "critical",
    title: "IDOR",
    endpoint: "GET /api/users/{id}",
    file: "src/app/api/users/[id]/route.ts:23",
    happened:
      "Endpoint returned other users' records when sequential identifiers were requested as a non-owner user.",
    proof:
      "GET /api/users/1..100 as user role\nResponse: 200 for 94 unauthorized records",
    fix: "Add ownership check before resource read in UserController and enforce scoped query.",
  },
  {
    id: "f-hsts",
    severity: "medium",
    title: "Missing HSTS Header",
    endpoint: "All responses",
    file: "src/middleware/securityHeaders.ts:11",
    happened: "HTTP Strict-Transport-Security header was missing in responses.",
    proof: "GET /\nResponse headers did not include Strict-Transport-Security",
    fix: "Enable HSTS middleware for all HTTPS responses.",
  },
  {
    id: "f-secrets",
    severity: "high",
    title: "Secret Token in Diff",
    endpoint: "N/A",
    file: "src/config/dev.env:5",
    happened: "Static API token appeared in commit diff and was not masked.",
    proof: "Detected token-like value in added line `API_TOKEN=sk_live_...`",
    fix: "Rotate token, remove from repo history, and move secret to environment store.",
  },
];

const owaspChecklist = [
  { id: "A01", label: "A01 Broken Access Control", status: "FAIL", detail: "3 findings" },
  { id: "A02", label: "A02 Cryptographic Failures", status: "PASS", detail: "0 findings" },
  { id: "A03", label: "A03 Injection", status: "FAIL", detail: "1 critical finding" },
  { id: "A04", label: "A04 Insecure Design", status: "PARTIAL", detail: "needs threat model" },
  { id: "A05", label: "A05 Security Misconfiguration", status: "FAIL", detail: "2 findings" },
  { id: "A06", label: "A06 Vulnerable Components", status: "PASS", detail: "0 CVEs" },
  { id: "A07", label: "A07 Auth Failures", status: "PASS", detail: "0 findings" },
  { id: "A08", label: "A08 Data Integrity Failures", status: "PASS", detail: "0 findings" },
  { id: "A09", label: "A09 Logging Failures", status: "PARTIAL", detail: "coverage incomplete" },
  { id: "A10", label: "A10 SSRF", status: "PASS", detail: "0 findings" },
];

const remediationChecklist = [
  { done: false, text: "Fix SQL injection in SearchController (CRITICAL)" },
  { done: false, text: "Add ownership check to UserController.js (CRITICAL)" },
  { done: false, text: "Add HSTS header to all responses (MEDIUM)" },
  { done: true, text: "Rotate leaked API token and invalidate previous credential" },
  { done: false, text: "Add pre-push secret scan gate in CI" },
];

const initialSections = {
  executive: true,
  appMap: true,
  findings: true,
  owasp: true,
  remediation: true,
};

function flattenFolderLines(nodes, depth = 0) {
  return nodes.flatMap((node) => {
    const prefix = `${"  ".repeat(depth)}${node.kind === "folder" ? "+" : "-"}`;
    const current = `${prefix} ${node.name}`;
    if (node.kind !== "folder") {
      return [current];
    }
    return [current, ...flattenFolderLines(node.children ?? [], depth + 1)];
  });
}

function owaspStateClass(status) {
  if (status === "FAIL") return "report-state-fail";
  if (status === "PARTIAL") return "report-state-partial";
  return "report-state-pass";
}

function severityClass(severity) {
  return `scanner-severity-${severity}`;
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
    lines.push(`- Endpoint: ${finding.endpoint}`);
    lines.push(`- File: ${finding.file}`);
    lines.push(`- What happened: ${finding.happened}`);
    lines.push(`- Proof: ${finding.proof.replace(/\n/g, " | ")}`);
    lines.push(`- Fix: ${finding.fix.replace(/\n/g, " | ")}`);
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
  const { started: scanStarted, duration } = useScanStore((state) => state.lastScan);
  const folderTree = useMapStore((state) => state.folderTree);
  const routes = useMapStore((state) => state.routes);

  const [sections, setSections] = React.useState(initialSections);
  const [exportStatus, setExportStatus] = React.useState("Ready");

  const folderLines = React.useMemo(() => flattenFolderLines(folderTree), [folderTree]);
  const routeLines = React.useMemo(
    () =>
      routes.map(
        (route) =>
          `${route.method.padEnd(6, " ")} ${route.path} | auth:${route.auth ? "yes" : "no"} | ${route.sourceFile}`,
      ),
    [routes],
  );

  const sortedFindings = React.useMemo(
    () => [...findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]),
    [],
  );

  const summaryText =
    "Total findings: 21 (2 critical, 5 high, 11 medium, 3 low). OWASP Top 10 coverage: 8/10 categories tested.";

  const exportPayload = React.useMemo(
    () => ({
      scanStarted,
      duration,
      summary: summaryText,
      sortedFindings,
      owasp: owaspChecklist,
      remediation: remediationChecklist,
      appMap: {
        folders: folderLines,
        routes: routeLines,
      },
    }),
    [duration, folderLines, routeLines, scanStarted, sortedFindings],
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

  return (
    <section className="report-view">
      <header className="report-toolbar">
        <div className="report-toolbar-meta">
          <span>Scan: {scanStarted}</span>
          <span>Duration: {duration}</span>
        </div>
        <div className="report-toolbar-actions">
          <button className="report-export-btn" onClick={() => handleExport("pdf")}>Export PDF</button>
          <button className="report-export-btn" onClick={() => handleExport("markdown")}>Export Markdown</button>
          <button className="report-export-btn" onClick={() => handleExport("json")}>Export JSON</button>
        </div>
      </header>

      <div className="report-status">{exportStatus}</div>

      <div className="report-document">
        <Section id="executive" title="EXECUTIVE SUMMARY" isOpen={sections.executive} onToggle={toggleSection}>
          <p>{summaryText}</p>
          <p>Critical issues requiring immediate fix:</p>
          <ul>
            <li>- SQL injection on search endpoint</li>
            <li>- IDOR on user resource endpoints</li>
          </ul>
        </Section>

        <Section id="appMap" title="APPLICATION MAP" isOpen={sections.appMap} onToggle={toggleSection}>
          <div className="report-map-grid">
            <div className="report-map-block">
              <h4>Folder Tree</h4>
              <pre>{folderLines.join("\n")}</pre>
            </div>
            <div className="report-map-block">
              <h4>Route Tree</h4>
              <pre>{routeLines.join("\n")}</pre>
            </div>
          </div>
        </Section>

        <Section id="findings" title="FINDINGS" isOpen={sections.findings} onToggle={toggleSection}>
          <div className="report-findings-list">
            {sortedFindings.map((finding) => (
              <article key={finding.id} className="report-finding-block">
                <header className="report-finding-head">
                  <span className={`report-severity ${severityClass(finding.severity)}`}>
                    [{finding.severity.toUpperCase()}]
                  </span>
                  <span>{finding.title}</span>
                </header>
                <p>Endpoint: {finding.endpoint}</p>
                <p>File: {finding.file}</p>
                <p>What happened:</p>
                <pre>{finding.happened}</pre>
                <p>Proof of Concept:</p>
                <pre>{finding.proof}</pre>
                <p>Fix:</p>
                <pre>{finding.fix}</pre>
              </article>
            ))}
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
