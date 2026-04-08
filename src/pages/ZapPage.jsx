import React from "react";
import { useZapStore } from "../store/zapStore";

export default function ZapPage() {
  const {
    targetUrl,
    setTargetUrl,
    status,
    alerts,
    loading,
    hydrate,
    startScan,
    pollStatus,
    loadAlerts,
    reset,
  } = useZapStore();

  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

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
              <span>OWASP ZAP</span>
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
                {loading ? "Starting..." : "Start Active Scan"}
              </button>

              <button className="scanner-start-btn" onClick={pollStatus}>
                Refresh Status
              </button>

              <button className="scanner-start-btn" onClick={loadAlerts}>
                Refresh Alerts
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
              <div className="scanner-line"><span>Started</span><strong>{status.startedAt || "--"}</strong></div>
              <div className="scanner-line"><span>Completed</span><strong>{status.completedAt || "--"}</strong></div>
              <div className="scanner-line"><span>Alerts</span><strong>{alerts.length}</strong></div>
              <div className="scanner-line"><span>Last Error</span><strong>{status.lastError || "--"}</strong></div>
            </div>
          </article>
        </div>

        <article className="scanner-box scanner-right-col">
          <header className="scanner-box-head scanner-findings-head">
            <span>ZAP Alerts</span>
            <span className="scanner-live-state">{alerts.length} total</span>
          </header>

          <div className="scanner-box-body scanner-findings-list">
            {alerts.length === 0 ? <div className="scanner-empty">No alerts yet.</div> : null}
            {alerts.map((alert) => (
              <article key={alert.id} className="scanner-finding-card">
                <header className="scanner-finding-head">
                  <span className={`scanner-severity scanner-severity-${alert.severity}`}>{alert.severity}</span>
                  <h3>{alert.name}</h3>
                </header>
                <div className="scanner-finding-preview">
                  <p>Endpoint: {alert.endpoint}</p>
                  <p>{alert.description || "No description"}</p>
                </div>
                <pre className="scanner-finding-detail">{`Proof: ${alert.proof || "n/a"}\nFix: ${alert.fix || "n/a"}`}</pre>
              </article>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
