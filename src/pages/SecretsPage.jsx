import React from "react";
import PageFrame from "../components/PageFrame";

export default function SecretsPage() {
  const actions = <button className="btn">Re-scan</button>;

  return (
    <PageFrame
      crumb="DOCKIUM / Secrets"
      title="Secrets Scanner"
      description="Credential leaks across source files, git history, and environment artifacts."
      actions={actions}
    >
      <div className="card">
        <div className="card-head"><h3>Detected Secrets</h3><span className="pill high">7 findings</span></div>
        <div className="card-body padless">
          <table className="table">
            <thead><tr><th>Type</th><th>Value Preview</th><th>Location</th><th>State</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td>AWS key</td><td>AKIA...EXAMPLE</td><td>config/aws.ts:14</td><td>In git history</td><td><button className="btn">Rotate</button></td></tr>
              <tr><td>JWT secret</td><td>eyJ...masked</td><td>src/lib/jwt.ts:8</td><td>Current branch</td><td><button className="btn">Invalidate</button></td></tr>
              <tr><td>Stripe key</td><td>sk_test_...masked</td><td>services/payments.ts:3</td><td>Current branch</td><td><button className="btn">Rotate</button></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </PageFrame>
  );
}
