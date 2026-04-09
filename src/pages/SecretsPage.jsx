import React from "react";
import PageFrame from "../components/PageFrame";
import { useSecretsStore } from "../store/secretsStore";

function severityClass(severity) {
  const normalized = String(severity || "info").toLowerCase();
  return `scanner-severity-${normalized}`;
}

export default function SecretsPage() {
  const {
    loading,
    rescanning,
    error,
    findings,
    summary,
    lastUpdated,
    hydrate,
    rescan,
  } = useSecretsStore();

  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

  const actions = (
    <button className="btn" onClick={rescan} disabled={rescanning || loading}>
      {rescanning ? "Scanning..." : "Re-scan"}
    </button>
  );

  return (
    <PageFrame
      crumb="DOCKIUM / Secrets"
      title="Secrets Scanner"
      description="Credential leaks across source files, git history, and environment artifacts."
      actions={actions}
    >
      <div className="card">
        <div className="card-head">
          <h3>Detected Secrets</h3>
          <span className="pill high">{summary.total} findings</span>
        </div>
        <div className="card-body padless">
          {error ? <div className="scanner-empty">{error}</div> : null}
          {lastUpdated ? (
            <div className="scanner-detail-row" style={{ padding: "10px 14px" }}>
              Last updated: {new Date(lastUpdated).toLocaleString()} | Critical: {summary.critical} | High: {summary.high} | Medium: {summary.medium}
            </div>
          ) : null}
          <table className="table">
            <thead><tr><th>Severity</th><th>Type</th><th>Value Preview</th><th>Location</th><th>State</th><th>Source</th></tr></thead>
            <tbody>
              {findings.length === 0 ? (
                <tr>
                  <td colSpan={6}>No secrets found in the current backend context.</td>
                </tr>
              ) : (
                findings.map((finding) => (
                  <tr key={finding.id}>
                    <td><span className={severityClass(finding.severity)}>[{finding.severity.toUpperCase()}]</span></td>
                    <td>{finding.type}</td>
                    <td>{finding.valuePreview}</td>
                    <td>{finding.location}</td>
                    <td>{finding.state}</td>
                    <td>{finding.source}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageFrame>
  );
}
