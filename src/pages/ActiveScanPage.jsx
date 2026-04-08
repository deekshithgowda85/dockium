import React from "react";
import { useNucleiStore } from "../store/nucleiStore";

function formatLocalTime(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "--") {
    return "--";
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return date.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function ActiveScanPage() {
  const [projectInfo, setProjectInfo] = React.useState(null);
  const {
    targetUrl,
    setTargetUrl,
    status,
    findings,
    loading,
    hydrate,
    startScan,
    pollStatus,
    loadFindings,
    reset,
    applyProgressEvent,
  } = useNucleiStore();

  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

  React.useEffect(() => {
    let mounted = true;

    const loadProjectInfo = async () => {
      const response = await window.dockium?.project?.getInfo?.();
      if (!mounted) {
        return;
      }
      if (!response?.ok) {
        setProjectInfo(null);
        return;
      }
      setProjectInfo(response.projectInfo || null);
    };

    loadProjectInfo();
    return () => {
      mounted = false;
    };
  }, [status.completedAt]);

  const hasProjectContext = Boolean(projectInfo?.projectPath);
  const candidateAttempts = Array.isArray(status?.diagnostics?.candidates)
    ? status.diagnostics.candidates
    : [];
  const templateSetup = status?.diagnostics?.templateSetup || null;
  const scannerPreflight = status?.preflight?.scanner || null;

  React.useEffect(() => {
    const wsApi = window.dockium?.ws;
    if (!wsApi?.onNucleiProgress) {
      return undefined;
    }

    const unsub = wsApi.onNucleiProgress((event) => {
      applyProgressEvent(event);
    });

    return () => {
      unsub?.();
    };
  }, [applyProgressEvent]);

  React.useEffect(() => {
    if (!status.active) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      pollStatus();
    }, 2500);

    return () => {
      window.clearInterval(timer);
    };
  }, [pollStatus, status.active]);

  React.useEffect(() => {
    if (status.active || !status.scanId) {
      return;
    }

    loadFindings();
  }, [loadFindings, status.active, status.completedAt, status.scanId]);

  return (
    <section className="scanner-view">
      <div className="scanner-grid">
        <div className="scanner-left-col">
          <article className="scanner-box">
            <header className="scanner-box-head">
              <span>Nuclei Active Scan</span>
              <span>{status.active ? "RUNNING" : "READY"}</span>
            </header>
            <div className="scanner-box-body scanner-control-body">
              <label className="scanner-field">
                <span>Target URL</span>
                <input
                  value={targetUrl}
                  onChange={(event) => setTargetUrl(event.target.value)}
                  placeholder="http://localhost:3000"
                />
              </label>

              <button className="scanner-start-btn" onClick={() => startScan(false)} disabled={loading || status.active || !hasProjectContext}>
                {loading ? "Starting..." : "Start Nuclei Scan"}
              </button>

              <button className="scanner-start-btn" onClick={() => startScan(true)} disabled={loading || status.active || !hasProjectContext}>
                Start + Recreate Scanner
              </button>

              {!hasProjectContext ? (
                <div className="scanner-empty">
                  No project loaded. Open New Project Setup first, then run active scan.
                </div>
              ) : null}

              <button className="scanner-start-btn" onClick={pollStatus}>
                Refresh Status
              </button>

              <button className="scanner-start-btn" onClick={loadFindings}>
                Refresh Findings
              </button>

              <button className="scanner-start-btn" onClick={reset}>
                Reset Session
              </button>
            </div>
          </article>

          <article className="scanner-box">
            <header className="scanner-box-head">
              <span>Status</span>
              <span>{status.percent || 0}%</span>
            </header>
            <div className="scanner-box-body scanner-current-body">
              <div className="scanner-line"><span>Scan ID</span><strong>{status.scanId || "--"}</strong></div>
              <div className="scanner-line"><span>Target</span><strong>{status.targetUrl || targetUrl || "--"}</strong></div>
              <div className="scanner-line"><span>Phase</span><strong>{status.phaseName || "idle"}</strong></div>
              <div className="scanner-line"><span>Started</span><strong>{formatLocalTime(status.startedAt)}</strong></div>
              <div className="scanner-line"><span>Completed</span><strong>{formatLocalTime(status.completedAt)}</strong></div>
              <div className="scanner-line"><span>Findings</span><strong>{findings.length}</strong></div>
              <div className="scanner-line">
                <span>Scanner Preflight</span>
                <strong>{scannerPreflight?.healthy ? "healthy" : scannerPreflight?.status || "--"}</strong>
              </div>
              <div className="scanner-line">
                <span>Scanner Recovery</span>
                <strong>{scannerPreflight?.recreated ? "auto-recreated" : "not-needed"}</strong>
              </div>
              <div className="scanner-line">
                <span>Template Source</span>
                <strong>{templateSetup?.source || "--"}</strong>
              </div>
              <div className="scanner-line">
                <span>Candidate Attempts</span>
                <strong>{candidateAttempts.length}</strong>
              </div>
              <div className="scanner-line"><span>Last Error</span><strong>{status.lastError || "--"}</strong></div>
            </div>
          </article>
        </div>

        <article className="scanner-box scanner-right-col">
          <header className="scanner-box-head scanner-findings-head">
            <span>Critical/High Findings</span>
            <span className="scanner-live-state">{findings.length} total</span>
          </header>

          <div className="scanner-box-body scanner-findings-list">
            {findings.length === 0 ? <div className="scanner-empty">No findings yet.</div> : null}
            {findings.map((finding) => (
              <article key={finding.id} className="scanner-finding-card">
                <header className="scanner-finding-head">
                  <span className={`scanner-severity scanner-severity-${finding.severity}`}>{finding.severity}</span>
                  <h3>{finding.name}</h3>
                </header>
                <div className="scanner-finding-preview">
                  <p>Endpoint: {finding.endpoint}</p>
                  <p>{finding.description || "No description"}</p>
                </div>
                <pre className="scanner-finding-detail">{`Template: ${finding.templateId || "n/a"}\nProof: ${finding.proof || "n/a"}\nFix: ${finding.fix || "n/a"}`}</pre>
              </article>
            ))}

            {candidateAttempts.length > 0 ? (
              <article className="scanner-finding-card">
                <header className="scanner-finding-head">
                  <span className="scanner-severity scanner-severity-info">diag</span>
                  <h3>Nuclei Candidate Diagnostics</h3>
                </header>
                <div className="scanner-finding-preview">
                  <p>Template setup: {templateSetup?.source || "unknown"}</p>
                  <p>
                    Warnings: {Array.isArray(templateSetup?.warnings) ? templateSetup.warnings.length : 0}
                  </p>
                </div>
                <pre className="scanner-finding-detail">{
                  candidateAttempts
                    .map((attempt) => {
                      const commands = Array.isArray(attempt.commands) ? attempt.commands.length : 0;
                      const statusText = attempt.status || "unknown";
                      const findingCount = Number(attempt.findingCount || 0);
                      const errorText = attempt.error ? ` | error: ${attempt.error}` : "";
                      return `${statusText.toUpperCase()} ${attempt.candidateUrl} | findings: ${findingCount} | commands: ${commands}${errorText}`;
                    })
                    .join("\n")
                }</pre>
              </article>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
