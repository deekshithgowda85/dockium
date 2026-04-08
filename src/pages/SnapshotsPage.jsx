import React from "react";
import PageFrame from "../components/PageFrame";

export default function SnapshotsPage() {
  const actions = <button className="btn primary">Create Snapshot</button>;

  return (
    <PageFrame
      crumb="DOCKIUM / Snapshots"
      title="Environment Snapshots"
      description="Save reproducible states for debugging and team handoff."
      actions={actions}
    >
      <div className="card">
        <div className="card-head"><h3>Saved Snapshots</h3><span className="pill info">4 saved</span></div>
        <div className="card-body padless">
          <table className="table">
            <thead><tr><th>Name</th><th>Context</th><th>Size</th><th>Created</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td>sqli-confirmed</td><td>Auth bypass reproduced</td><td>2.1 GB</td><td>Apr 5, 09:42</td><td><button className="btn">Restore</button></td></tr>
              <tr><td>jwt-none-check</td><td>Token policy exploit</td><td>1.8 GB</td><td>Apr 5, 09:41</td><td><button className="btn">Restore</button></td></tr>
              <tr><td>idor-basket</td><td>Cross-user object access</td><td>1.9 GB</td><td>Apr 5, 09:40</td><td><button className="btn">Restore</button></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </PageFrame>
  );
}
