import React from "react";
import PageFrame from "../components/PageFrame";
import { useSnapshotsStore } from "../store/snapshotsStore";

export default function SnapshotsPage() {
  const {
    loading,
    busy,
    error,
    status,
    snapshots,
    hydrate,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot,
  } = useSnapshotsStore();

  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

  const handleCreateSnapshot = async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await createSnapshot({
      name: `snapshot-${timestamp}`,
      context: "Manual snapshot from Snapshots page",
    });
  };

  const actions = (
    <button className="btn primary" onClick={handleCreateSnapshot} disabled={busy || loading}>
      {busy ? "Working..." : "Create Snapshot"}
    </button>
  );

  return (
    <PageFrame
      crumb="DOCKIUM / Snapshots"
      title="Environment Snapshots"
      description="Save reproducible states for debugging and team handoff."
      actions={actions}
    >
      <div className="card">
        <div className="card-head"><h3>Saved Snapshots</h3><span className="pill info">{snapshots.length} saved</span></div>
        <div className="card-body padless">
          {error ? <div className="scanner-empty">{error}</div> : null}
          {status ? <div className="scanner-detail-row" style={{ padding: "10px 14px" }}>{status}</div> : null}
          <table className="table">
            <thead><tr><th>Name</th><th>Context</th><th>Size</th><th>Created</th><th>Action</th></tr></thead>
            <tbody>
              {snapshots.length === 0 ? (
                <tr>
                  <td colSpan={5}>No snapshots yet. Create one to persist your current environment metadata.</td>
                </tr>
              ) : (
                snapshots.map((snapshot) => (
                  <tr key={snapshot.id}>
                    <td>{snapshot.name}</td>
                    <td>{snapshot.context || "-"}</td>
                    <td>{snapshot.sizeLabel}</td>
                    <td>{snapshot.createdLabel}</td>
                    <td>
                      <button className="btn" onClick={() => restoreSnapshot(snapshot.id)} disabled={busy}>Restore</button>
                      <button className="btn" onClick={() => deleteSnapshot(snapshot.id)} disabled={busy}>Delete</button>
                    </td>
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
