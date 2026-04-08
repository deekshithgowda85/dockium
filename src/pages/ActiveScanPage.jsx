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

              <button className="scanner-start-btn" onClick={startScan} disabled={loading || status.active}>
                {loading ? "Starting..." : "Start Nuclei Scan"}
              </button>

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
          </div>
        </article>
      </div>
    </section>
  );
}
