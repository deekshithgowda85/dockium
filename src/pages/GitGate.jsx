import React from "react";
import { useGitStore } from "../store/gitStore";

function Toggle({ enabled, onToggle }) {
  return (
    <button
      type="button"
      className={enabled ? "gitgate-toggle on" : "gitgate-toggle"}
      onClick={onToggle}
      aria-pressed={enabled}
    >
      <span className="gitgate-toggle-knob" />
    </button>
  );
}

function resultClass(result) {
  return result === "BLOCKED" ? "gitgate-result-blocked" : "gitgate-result-forwarded";
}

export default function GitGate() {
  const {
    gateInstalled,
    hookPath,
    remote,
    rules,
    pushHistory,
    expandedPushId,
    lastTestResult,
    hydrate,
    installGate,
    removeGate,
    testGate,
    toggleRule,
    setThreshold,
    toggleExpandedPush,
  } = useGitStore();

  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <section className="gitgate-view">
      <section className="gitgate-panel">
        <header className="gitgate-head">GIT GATE</header>
        <div className="gitgate-body">
          <div className="gitgate-status-line">
            <span>Status:</span>
            <strong className={gateInstalled ? "gitgate-installed" : "gitgate-not-installed"}>
              {gateInstalled ? "INSTALLED" : "NOT INSTALLED"}
            </strong>
          </div>
          <div className="gitgate-status-line">
            <span>Hook path:</span>
            <strong>{hookPath}</strong>
          </div>
          <div className="gitgate-status-line">
            <span>Remote:</span>
            <strong>{remote}</strong>
          </div>
          <div className="gitgate-actions">
            <button className="gitgate-btn" onClick={installGate}>Install Gate</button>
            <button className="gitgate-btn" onClick={removeGate}>Remove Gate</button>
            <button className="gitgate-btn gitgate-btn-primary" onClick={testGate}>Test Gate</button>
            <span className="gitgate-test-result">Last test: {lastTestResult}</span>
          </div>
        </div>
      </section>

      <section className="gitgate-panel">
        <header className="gitgate-head">GATE RULES</header>
        <div className="gitgate-body gitgate-rules-grid">
          <label className="gitgate-rule">
            <Toggle enabled={rules.blockCritical} onToggle={() => toggleRule("blockCritical")} />
            <span className="gitgate-rule-label">Block on: Critical findings</span>
          </label>
          <label className="gitgate-rule">
            <Toggle enabled={rules.blockHigh} onToggle={() => toggleRule("blockHigh")} />
            <span className="gitgate-rule-label">Block on: High findings</span>
          </label>
          <label className="gitgate-rule">
            <Toggle enabled={rules.blockMedium} onToggle={() => toggleRule("blockMedium")} />
            <span className="gitgate-rule-label">Block on: Medium findings</span>
          </label>
          <label className="gitgate-rule">
            <Toggle enabled={rules.blockSecrets} onToggle={() => toggleRule("blockSecrets")} />
            <span className="gitgate-rule-label">Block on: Secrets detected in diff</span>
          </label>
          <label className="gitgate-rule">
            <Toggle enabled={rules.blockTestFailures} onToggle={() => toggleRule("blockTestFailures")} />
            <span className="gitgate-rule-label">Block on: Test suite failures</span>
          </label>
          <label className="gitgate-rule">
            <Toggle
              enabled={rules.blockUnscannedRoutes}
              onToggle={() => toggleRule("blockUnscannedRoutes")}
            />
            <span className="gitgate-rule-label">Block on: New unscanned routes</span>
          </label>

          <div className="gitgate-threshold-row">
            <span>Threshold: Block if findings &gt;=</span>
            <input
              type="number"
              min={1}
              value={rules.threshold}
              onChange={(event) => setThreshold(event.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="gitgate-panel gitgate-history-panel">
        <header className="gitgate-head">PUSH HISTORY</header>
        <div className="gitgate-body gitgate-history-body">
          <table className="gitgate-table">
            <thead>
              <tr>
                <th>#</th>
                <th>TIMESTAMP</th>
                <th>BRANCH</th>
                <th>COMMIT</th>
                <th>RESULT</th>
                <th>FINDINGS</th>
                <th>DURATION</th>
              </tr>
            </thead>
            <tbody>
              {pushHistory.map((push) => {
                const expanded = expandedPushId === push.id;
                return (
                  <React.Fragment key={push.id}>
                    <tr className="gitgate-row" onClick={() => toggleExpandedPush(push.id)}>
                      <td>{push.id}</td>
                      <td>{push.timestamp}</td>
                      <td>{push.branch}</td>
                      <td>{push.commit}</td>
                      <td className={resultClass(push.result)}>{push.result}</td>
                      <td>{push.findings}</td>
                      <td>{push.duration}</td>
                    </tr>

                    {expanded ? (
                      <tr className="gitgate-detail-row">
                        <td colSpan={7}>
                          <section className="gitgate-detail-box">
                            <header className="gitgate-detail-head">
                              PUSH #{push.id} - {push.result}
                            </header>

                            <div className="gitgate-detail-body">
                              <p><strong>Reason:</strong> {push.reason}</p>

                              <div>
                                <strong>New routes in this commit:</strong>
                                <ul>
                                  {push.newRoutes.length === 0 ? (
                                    <li>None</li>
                                  ) : (
                                    push.newRoutes.map((route) => (
                                      <li key={`${push.id}-${route.route}`}>
                                        {route.route} [{route.state}]
                                      </li>
                                    ))
                                  )}
                                </ul>
                              </div>

                              <div>
                                <strong>Findings:</strong>
                                <ul>
                                  {push.findingsTriggered.length === 0 ? (
                                    <li>No blocking findings</li>
                                  ) : (
                                    push.findingsTriggered.map((finding) => (
                                      <li key={`${push.id}-${finding}`}>{finding}</li>
                                    ))
                                  )}
                                </ul>
                              </div>

                              <div>
                                <strong>Exact diff that was scanned:</strong>
                                <pre>{push.diff}</pre>
                              </div>

                              <p><strong>Exact commit message:</strong> {push.commitMessage}</p>
                              <p>To fix and retry: resolve findings, then git push again.</p>
                            </div>
                          </section>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
