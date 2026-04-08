import React from "react";
import PageFrame from "../components/PageFrame";

export default function NewProjectPage() {
  return (
    <PageFrame
      crumb="DOCKIUM / New Project"
      title="New Project Wizard"
      description="Configure repository, credentials, and modules before launching scan containers."
    >
      <div className="card">
        <div className="card-head">
          <h3>Project Setup</h3>
          <span className="pill info">Step 3/4</span>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field"><label>Project Name</label><input value="dockium-lab" readOnly /></div>
            <div className="field"><label>Repository Path</label><input value="D:/Projects/dockium" readOnly /></div>
            <div className="field"><label>App URL</label><input value="http://localhost:3000" readOnly /></div>
            <div className="field"><label>Proxy Port</label><input value="8080" readOnly /></div>
            <div className="field"><label>Admin Email</label><input value="admin@dockium.local" readOnly /></div>
            <div className="field"><label>Admin Password</label><input value="********" readOnly /></div>
          </div>
          <div className="right-actions">
            <button className="btn">Cancel</button>
            <button className="btn">Save Draft</button>
            <button className="btn primary">Create and Start</button>
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
