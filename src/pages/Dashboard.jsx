import React from "react";
import { useDummyPageApi } from "../hooks/useDummyPageApi";
import { useContainerStore } from "../store/containerStore";
import { useUiStore } from "../store/uiStore";
import { useScanStore } from "../store/scanStore";

function statusClass(status) {
  if (status === "RUNNING") return "status-running";
  if (status === "BOOTING") return "status-booting";
  return "status-stopped";
}

export default function Dashboard() {
  const {
    projectName,
    projectPath,
    framework,
    targetUrl,
    dbType,
    routeCount,
    appStatus,
    containers,
    hydrate,
    openProject,
    stopAll,
    restartAll,
  } = useContainerStore();

  const {
    lastScan,
    activityLog,
    runFullScan,
    openInProxy,
    exportReport,
    viewReport,
  } = useScanStore();

  const { openOnboardingModal } = useUiStore();
  const { isLoading, refresh } = useDummyPageApi("dashboard");

  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (isLoading) {
    return (
      <section className="dashboard-page">
        <div className="dashboard-loading">
          <div className="loading-row" />
          <div className="loading-row wide" />
          <div className="loading-grid">
            <div className="loading-card" />
            <div className="loading-card" />
          </div>
          <div className="loading-row" />
          <div className="loading-row mid" />
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-page">
      <div className="dashboard-grid">
        <div className="dashboard-left">
          <section className="dash-box">
            <header className="dash-head">PROJECT</header>
            <div className="dash-content">
              <div className="dash-line"><span>Name:</span><strong>{projectName}</strong></div>
              <div className="dash-line"><span>Path:</span><strong>{projectPath}</strong></div>
              <div className="dash-line"><span>Framework:</span><strong>{framework}</strong></div>
              <div className="dash-line"><span>Target URL:</span><strong>{targetUrl}</strong></div>
              <div className="dash-line"><span>DB Type:</span><strong>{dbType}</strong></div>
              <div className="dash-line"><span>Routes:</span><strong>{routeCount}</strong></div>
              <div className="dash-line">
                <span>Status:</span>
                <strong className={`status-pill ${statusClass(appStatus)}`}>{appStatus}</strong>
              </div>
              <div className="dash-actions">
                <button className="dash-btn" onClick={openProject}>Open Project</button>
                <button className="dash-btn" onClick={stopAll}>Stop All</button>
                <button className="dash-btn" onClick={restartAll}>Restart</button>
              </div>
            </div>
          </section>

          <section className="dash-box">
            <header className="dash-head">CONTAINERS</header>
            <div className="dash-content dash-content-padless">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>NAME</th>
                    <th>STATUS</th>
                    <th>CREATED</th>
                    <th>PORT</th>
                    <th>CPU</th>
                    <th>MEM</th>
                  </tr>
                </thead>
                <tbody>
                  {containers.map((container) => (
                    <tr key={container.name}>
                      <td>{container.name}</td>
                      <td className={statusClass(container.status)}>{container.status.toLowerCase()}</td>
                      <td>{container.created}</td>
                      <td>{container.port}</td>
                      <td>{container.cpu}</td>
                      <td>{container.mem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="dash-box">
            <header className="dash-head">LAST SCAN</header>
            <div className="dash-content">
              <div className="dash-line-combo">
                <span>Started: {lastScan.started}</span>
                <span>Duration: {lastScan.duration}</span>
              </div>
              <div className="dash-line-combo">
                <span className="status-stopped">Critical: {lastScan.critical}</span>
                <span className="status-booting">High: {lastScan.high}</span>
                <span>Medium: {lastScan.medium}</span>
                <span>Low: {lastScan.low}</span>
              </div>
              <div className="dash-actions">
                <button className="dash-btn" onClick={viewReport}>View Report</button>
                <button
                  className="dash-btn"
                  onClick={() => {
                    refresh();
                    hydrate();
                  }}
                >
                  Refresh Data
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="dashboard-right">
          <section className="dash-box">
            <header className="dash-head">QUICK ACTIONS</header>
            <div className="dash-content quick-actions-stack">
              <button className="dash-btn" onClick={openOnboardingModal}>New Project Setup</button>
              <button className="dash-btn dash-btn-primary" onClick={runFullScan}>Run Full Scan</button>
              <button className="dash-btn" onClick={openInProxy}>Open in Proxy</button>
              <button className="dash-btn" onClick={exportReport}>Export Report</button>
            </div>
          </section>

          <section className="dash-box activity-box">
            <header className="dash-head">ACTIVITY LOG</header>
            <div className="dash-content activity-log">
              {activityLog.map((entry, index) => (
                <div className="activity-row" key={`${entry.time}-${index}`}>
                  <span className="activity-time">{entry.time}</span>
                  <span className="activity-msg">{entry.message}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
