import React from "react";
import { useScanStore } from "../store/scanStore";
import { useFleetStore } from "../store/fleetStore";

function cleanUiText(value) {
  const raw = String(value ?? "");
  const noAnsi = raw.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
  const noControl = noAnsi.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return noControl.replace(/\s+/g, " ").trim();
}

function ensureHttpUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  if (text === "--") {
    return "";
  }

  if (/^https?:\/\//i.test(text)) {
    return text;
  }

  return `http://${text.replace(/^\/+/, "")}`;
}

function sessionPanelUrl(currentUrl) {
  const normalized = ensureHttpUrl(currentUrl);
  if (!normalized) {
    return "about:blank";
  }

  try {
    const parsed = new URL(normalized);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return "about:blank";
    }

    const p = parsed.pathname.toLowerCase();
    if (p.startsWith("/api/") || p.startsWith("/rest/")) {
      return `${parsed.origin}/`;
    }
    return parsed.toString();
  } catch {
    return "about:blank";
  }
}

function sessionPreviewImage(value) {
  const text = String(value || "").trim();
  if (!text.startsWith("data:image/")) {
    return "";
  }
  return text;
}

function isApiLikeSessionUrl(currentUrl) {
  const normalized = ensureHttpUrl(currentUrl);
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    const p = parsed.pathname.toLowerCase();
    return p.startsWith("/api/") || p.startsWith("/rest/") || p.endsWith(".json");
  } catch {
    return false;
  }
}

const severityTabs = ["all", "critical", "high", "medium", "low", "info"];
const STREAM_INTERVAL_MS = 1400;
const STREAM_FRAMES_PER_MIN = Number((60000 / STREAM_INTERVAL_MS).toFixed(1));

function percentBar(percent) {
  const value = Math.max(0, Math.min(100, Number(percent || 0)));
  const filled = Math.round(value / 5);
  const empty = Math.max(0, 20 - filled);
  return `${"#".repeat(filled)}${".".repeat(empty)}`;
}

export default function Scanner() {
  const {
    scanTarget,
    setScanTarget,
    scanMode,
    setScanMode,
    modules,
    toggleModule,
    isScanRunning,
    scanProgress,
    findings,
    lastScan,
    activityLog: scanActivityLog,
    runFullScan,
    runQuickScan,
    hydrateStatus,
  } = useScanStore();
  const {
    fleetStatus,
    headless,
    useProxy,
    windowCount,
    sessions,
    selectedSessionId,
    selectSession,
    activityLog: fleetActivityLog,
    setHeadless,
    setUseProxy,
    setWindowCount,
    startFleet,
    stopFleet,
    hydrate: hydrateFleet,
  } = useFleetStore();

  const [activeTab, setActiveTab] = React.useState("all");
  const [expanded, setExpanded] = React.useState({});
  const [isInteractiveFull, setIsInteractiveFull] = React.useState(false);
  const [fullSidebarHidden, setFullSidebarHidden] = React.useState(true);
  const interactiveWebviewRef = React.useRef(null);

  React.useEffect(() => {
    hydrateStatus();
    hydrateFleet();
  }, [hydrateFleet, hydrateStatus]);

  React.useEffect(() => {
    if (headless !== "ON") {
      setHeadless("ON");
    }
  }, [headless, setHeadless]);

  const filteredFindings = React.useMemo(() => {
    if (activeTab === "all") {
      return findings;
    }
    return findings.filter((finding) => String(finding.severity || "").toLowerCase() === activeTab);
  }, [activeTab, findings]);

  const runScan = () => {
    if (String(scanMode).toLowerCase().startsWith("quick")) {
      runQuickScan();
      return;
    }
    runFullScan();
  };

  const selectedSession = React.useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId],
  );

  const selectedSessionUrl = sessionPanelUrl(selectedSession?.current);
  const selectedSessionImage = sessionPreviewImage(selectedSession?.previewUrl);
  const selectedCanUseImage = Boolean(selectedSessionImage);
  const interactiveWebviewStyle = React.useMemo(
    () => ({
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      minHeight: "100%",
      minWidth: "100%",
      backgroundColor: "#ffffff",
      border: "none",
      margin: 0,
      padding: 0,
    }),
    [],
  );

  const emitSidebarState = React.useCallback((collapsed) => {
    window.dispatchEvent(new CustomEvent("dockium:sidebar:set", { detail: { collapsed } }));
  }, []);

  const openInteractiveFull = React.useCallback(() => {
    if (!selectedSession || selectedSessionUrl === "about:blank") {
      return;
    }
    setIsInteractiveFull(true);
    setFullSidebarHidden(true);
    emitSidebarState(true);
  }, [emitSidebarState, selectedSession, selectedSessionUrl]);

  const closeInteractiveFull = React.useCallback(() => {
    setIsInteractiveFull(false);
  }, []);

  const toggleSidebarInFull = React.useCallback(() => {
    const next = !fullSidebarHidden;
    setFullSidebarHidden(next);
    emitSidebarState(next);
  }, [emitSidebarState, fullSidebarHidden]);

  React.useEffect(() => {
    if (!isInteractiveFull || !selectedSession) {
      return undefined;
    }

    const webview = interactiveWebviewRef.current;
    if (!webview) {
      return undefined;
    }

    const syncGuestBounds = () => {
      try {
        const rect = webview.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        webview.setAttribute("autosize", "on");
        webview.setAttribute("minwidth", String(width));
        webview.setAttribute("minheight", String(height));
        webview.setAttribute("maxwidth", String(width));
        webview.setAttribute("maxheight", String(height));
      } catch {
      }
    };

    const onReady = () => syncGuestBounds();
    webview.addEventListener("dom-ready", onReady);
    webview.addEventListener("did-finish-load", onReady);
    window.addEventListener("resize", syncGuestBounds);
    syncGuestBounds();

    return () => {
      webview.removeEventListener("dom-ready", onReady);
      webview.removeEventListener("did-finish-load", onReady);
      window.removeEventListener("resize", syncGuestBounds);
    };
  }, [isInteractiveFull, selectedSession, selectedSessionUrl]);

  if (isInteractiveFull && selectedSession) {
    return (
      <section className="scanner-interactive-page">
        <header className="scanner-box-head scanner-interactive-head">
          <span>{selectedSession.role} LIVE BROWSER</span>
          <span>interactive | {STREAM_FRAMES_PER_MIN}/min stream side panel</span>
        </header>
        <div className="scanner-interactive-layout">
          <aside className="scanner-full-view-meta">
            <div className="scanner-line"><span>Role</span><strong>{selectedSession.role}</strong></div>
            <div className="scanner-line"><span>Status</span><strong>{selectedSession.status}</strong></div>
            <div className="scanner-line"><span>Requests</span><strong>{selectedSession.requestsCount}</strong></div>
            <div className="scanner-line"><span>Stream Rate</span><strong>{STREAM_FRAMES_PER_MIN}/min</strong></div>
            <div className="scanner-line"><span>Interval</span><strong>{(STREAM_INTERVAL_MS / 1000).toFixed(1)}s</strong></div>
            <div className="scanner-full-view-buttons">
              <button className="scanner-expand-btn" onClick={closeInteractiveFull}>Exit Full Browser</button>
              <button className="scanner-expand-btn" onClick={toggleSidebarInFull}>
                {fullSidebarHidden ? "Show Sidebar" : "Hide Sidebar"}
              </button>
            </div>
            <p>{cleanUiText(selectedSession.current || "--")}</p>
          </aside>
          <div className="scanner-full-view-canvas">
            {selectedSessionUrl !== "about:blank" ? (
              <webview
                key={`interactive-${selectedSession.id}-${selectedSessionUrl}`}
                ref={interactiveWebviewRef}
                className="scanner-interactive-webview"
                src={selectedSessionUrl}
                partition={`persist:dockium-interactive-${selectedSession.id}`}
                style={interactiveWebviewStyle}
                autosize="on"
                minwidth="960"
                minheight="720"
                allowpopups="true"
              />
            ) : (
              <div className="scanner-live-placeholder">No interactive URL available for this session.</div>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="scanner-view">
      <div className="scanner-grid">
        <div className="scanner-left-col">
          <article className="scanner-box">
            <header className="scanner-box-head">
              <span>Scan Control</span>
              <span>{isScanRunning ? "RUNNING" : "READY"}</span>
            </header>
            <div className="scanner-box-body scanner-control-body">
              <label className="scanner-field">
                <span>Target</span>
                <input
                  value={scanTarget}
                  onChange={(event) => setScanTarget(event.target.value)}
                  placeholder="localhost:3000"
                />
              </label>

              <label className="scanner-field">
                <span>Mode</span>
                <select value={scanMode} onChange={(event) => setScanMode(event.target.value)}>
                  <option value="Full Scan">Full Scan</option>
                  <option value="Quick Scan">Quick Scan</option>
                </select>
              </label>

              <div className="scanner-modules">
                <p>Modules</p>
                <div className="scanner-modules-grid">
                  {modules.map((module) => (
                    <label key={module.id} className="scanner-module-item">
                      <input
                        type="checkbox"
                        checked={module.enabled}
                        onChange={() => toggleModule(module.id)}
                      />
                      <span>{module.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="scanner-modules-grid">
                <label className="scanner-field">
                  <span>Fleet windows</span>
                  <select value={windowCount} onChange={(event) => setWindowCount(Number(event.target.value))}>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                    <option value={5}>5</option>
                    <option value={6}>6</option>
                  </select>
                </label>
                <label className="scanner-field">
                  <span>Fleet view</span>
                  <select value="ON" disabled>
                    <option value="ON">Embedded In-App Chromium</option>
                  </select>
                </label>
                <label className="scanner-field">
                  <span>Route through proxy</span>
                  <select value={useProxy ? "ON" : "OFF"} onChange={(event) => setUseProxy(event.target.value === "ON")}>
                    <option value="OFF">OFF (recommended)</option>
                    <option value="ON">ON</option>
                  </select>
                </label>
              </div>

              <div className="scanner-modules-grid">
                <button className="scanner-start-btn" onClick={runScan} disabled={isScanRunning}>
                  {isScanRunning ? "Scan Running" : "Start Scan"}
                </button>
                <button className="scanner-start-btn" onClick={fleetStatus === "RUNNING" ? stopFleet : startFleet}>
                  {fleetStatus === "RUNNING" ? "Stop Chromium Fleet" : "Start Chromium Fleet"}
                </button>
              </div>
            </div>
          </article>

          <article className="scanner-box">
            <header className="scanner-box-head">
              <span>Current Run</span>
              <span>{scanProgress.phaseName || "idle"}</span>
            </header>
            <div className="scanner-box-body scanner-current-body">
              <div className="scanner-line"><span>Fleet</span><strong>{fleetStatus}</strong></div>
              <div className="scanner-line"><span>Started</span><strong>{lastScan.started}</strong></div>
              <div className="scanner-line"><span>Duration</span><strong>{lastScan.duration}</strong></div>
              <div className="scanner-line scanner-progress-line">
                <span>Progress</span>
                <div className="scanner-progress-track">
                  <span className="scanner-progress-filled">{percentBar(scanProgress.percent)}</span>
                </div>
                <strong>{Math.max(0, Math.min(100, Number(scanProgress.percent || 0)))}%</strong>
              </div>
              <div className="scanner-line"><span>Critical</span><strong>{lastScan.critical}</strong></div>
              <div className="scanner-line"><span>High</span><strong>{lastScan.high}</strong></div>
              <div className="scanner-line"><span>Medium</span><strong>{lastScan.medium}</strong></div>
              <div className="scanner-line"><span>Low</span><strong>{lastScan.low}</strong></div>
            </div>
          </article>
        </div>

        <article className="scanner-box scanner-right-col">
          <header className="scanner-box-head scanner-findings-head">
            <span>Findings</span>
            <span className="scanner-live-state">{filteredFindings.length} shown</span>
          </header>
          <div className="scanner-box-body scanner-findings-body">
            <div className="scanner-filter-tabs">
              {severityTabs.map((tab) => (
                <button
                  key={tab}
                  className={activeTab === tab ? "scanner-tab active" : "scanner-tab"}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="scanner-findings-list">
              {filteredFindings.length === 0 ? (
                <div className="scanner-empty">No findings for this filter.</div>
              ) : null}

              {filteredFindings.map((finding) => {
                const isExpanded = Boolean(expanded[finding.id]);
                return (
                  <article key={finding.id} className="scanner-finding-card">
                    <header className="scanner-finding-head">
                      <span className={`scanner-severity scanner-severity-${finding.severity}`}>{finding.severity}</span>
                      <h3>{finding.title}</h3>
                    </header>

                    <div className="scanner-finding-preview">
                      <p>Endpoint: {finding.endpoint}</p>
                      <p>What: {finding.what}</p>
                    </div>

                    <button
                      className="scanner-expand-btn"
                      onClick={() => setExpanded((state) => ({ ...state, [finding.id]: !isExpanded }))}
                    >
                      {isExpanded ? "Hide details" : "Show details"}
                    </button>

                    {isExpanded ? (
                      <pre className="scanner-finding-detail">{`Payload: ${finding.payload}\nProof: ${finding.proof}\nFix: ${finding.fix}`}</pre>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        </article>
      </div>

      <section className="scanner-box scanner-live-shell" style={{ marginTop: 10 }}>
        <header className="scanner-box-head">
          <span>Live Browser Testing</span>
          <div className="scanner-live-head-actions">
            <span>{sessions.length} sessions | stream {STREAM_FRAMES_PER_MIN}/min each</span>
            <button
              className="scanner-expand-btn"
              onClick={openInteractiveFull}
              disabled={!selectedSession || selectedSessionUrl === "about:blank"}
            >
              Full Live Browser
            </button>
          </div>
        </header>
        <div className="scanner-box-body">
          <div className="scanner-live-grid">
            {sessions.length === 0 ? (
              <div className="scanner-empty">No active browser sessions. Start Chromium Fleet to see live activity.</div>
            ) : (
              sessions.slice(0, 6).map((session) => {
                const previewImage = sessionPreviewImage(session.previewUrl);
                return (
                  <article
                    key={`live-${session.id}`}
                    className={`scanner-live-card ${selectedSession?.id === session.id ? "selected" : ""}`}
                    onClick={() => selectSession(session.id)}
                  >
                    <header>
                      <strong>{session.role}</strong>
                      <span>{session.status}</span>
                    </header>
                    <div className="scanner-live-webview-wrap">
                      {previewImage ? (
                        <img
                          className="scanner-live-preview-image"
                          src={previewImage}
                          alt={`${session.role} live preview`}
                        />
                      ) : (
                        <div className="scanner-live-placeholder">Stream warming up...</div>
                      )}
                    </div>
                    <p>Requests: {session.requestsCount}</p>
                    <p>Last: {cleanUiText(session.last || "--")}</p>
                  </article>
                );
              })
            )}
          </div>

          {selectedSession ? (
            <div className="scanner-live-focus">
              <header>
                <strong>{selectedSession.role} Focus View</strong>
                <span>{selectedSession.status}</span>
              </header>
              <div className="scanner-live-focus-actions">
                <button
                  className="scanner-expand-btn"
                  onClick={openInteractiveFull}
                  disabled={selectedSessionUrl === "about:blank"}
                >
                  Open Interactive Full Browser
                </button>
              </div>
              <div className="scanner-live-focus-webview-wrap">
                {selectedCanUseImage ? (
                  <img
                    className="scanner-live-preview-image"
                    src={selectedSessionImage}
                    alt={`${selectedSession.role} focus preview`}
                  />
                ) : (
                  <div className="scanner-live-placeholder">Stream warming up...</div>
                )}
              </div>
              <p>{cleanUiText(selectedSession.current || "--")}</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="fleet-detail" style={{ marginTop: 10 }}>
        <header className="fleet-detail-head">
          <span>{selectedSession?.role ?? "SESSION"} REQUESTS</span>
          <span>{selectedSession?.requests?.length ?? 0} captured</span>
        </header>

        <div className="fleet-detail-body">
          <table className="fleet-request-table">
            <thead>
              <tr>
                <th>#</th>
                <th>METHOD</th>
                <th>HOST</th>
                <th>PATH</th>
                <th>STATUS</th>
                <th>TIME</th>
              </tr>
            </thead>
            <tbody>
              {(selectedSession?.requests ?? []).map((request, index) => (
                <tr key={request.id}>
                  <td>{index + 1}</td>
                  <td>{request.method}</td>
                  <td>{request.host}</td>
                  <td>{request.path}</td>
                  <td>{request.status}</td>
                  <td>{request.timeMs}ms</td>
                </tr>
              ))}
              {(selectedSession?.requests ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="fleet-empty-row">No requests for this session.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fleet-activity" style={{ marginTop: 10 }}>
        <header className="fleet-detail-head"><span>Fleet Activity</span></header>
        <div className="fleet-activity-body">
          {fleetActivityLog.map((line, index) => (
            <p key={`fleet-activity-${index}`}>{cleanUiText(line)}</p>
          ))}
        </div>
      </section>

      <section className="fleet-activity" style={{ marginTop: 10 }}>
        <header className="fleet-detail-head"><span>Scanner Activity</span></header>
        <div className="fleet-activity-body">
          {scanActivityLog.map((line, index) => (
            <p key={`scan-activity-${index}`}>{line.time} {cleanUiText(line.message)}</p>
          ))}
        </div>
      </section>
    </section>
  );
}
