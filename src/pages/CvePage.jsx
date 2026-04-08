import React from "react";
import PageFrame from "../components/PageFrame";

export default function CvePage() {
  const actions = <button className="btn primary">Auto-fix Safe Upgrades</button>;

  return (
    <PageFrame
      crumb="DOCKIUM / CVE Scanner"
      title="Dependency Vulnerabilities"
      description="Actionable dependency upgrade list with direct fix targets."
      actions={actions}
    >
      <div className="card">
        <div className="card-head"><h3>Vulnerable Packages</h3><span className="pill medium">3 packages</span></div>
        <div className="card-body padless">
          <table className="table">
            <thead><tr><th>Package</th><th>Current</th><th>Fixed</th><th>CVE</th><th>Severity</th></tr></thead>
            <tbody>
              <tr><td>jsonwebtoken</td><td>8.5.1</td><td>9.0.0</td><td>CVE-2022-23529</td><td><span className="pill critical">critical</span></td></tr>
              <tr><td>express</td><td>4.17.1</td><td>4.18.2</td><td>CVE-2022-24999</td><td><span className="pill high">high</span></td></tr>
              <tr><td>multer</td><td>1.4.3</td><td>1.4.5-lts.1</td><td>CVE-2022-24434</td><td><span className="pill high">high</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </PageFrame>
  );
}
