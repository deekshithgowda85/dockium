import { create } from "zustand";

function normalizeSnapshot(snapshot, index) {
  const createdAt = String(snapshot?.createdAt || new Date().toISOString());
  const summary = snapshot?.summary || {};
  const findings = summary?.findings || {};

  return {
    id: String(snapshot?.id || `snapshot-${index + 1}`),
    name: String(snapshot?.name || "snapshot"),
    context: String(snapshot?.context || ""),
    createdAt,
    createdLabel: new Date(createdAt).toLocaleString(),
    projectName: String(snapshot?.projectName || ""),
    projectPath: String(snapshot?.projectPath || ""),
    sizeLabel: String(snapshot?.sizeLabel || "0 B"),
    restoredAt: String(snapshot?.restoredAt || ""),
    summary: {
      findings: {
        total: Number(findings?.total || 0),
        critical: Number(findings?.critical || 0),
        high: Number(findings?.high || 0),
        medium: Number(findings?.medium || 0),
        low: Number(findings?.low || 0),
        info: Number(findings?.info || 0),
      },
      routeCount: Number(summary?.routeCount || 0),
      proxyRequests: Number(summary?.proxyRequests || 0),
    },
  };
}

export const useSnapshotsStore = create((set) => ({
  loading: false,
  busy: false,
  error: "",
  status: "",
  snapshots: [],

  hydrate: async () => {
    set({ loading: true, error: "" });
    const response = await window.dockium?.snapshots?.list?.();
    if (!response?.ok) {
      set({ loading: false, error: String(response?.error || "Failed to load snapshots") });
      return;
    }

    const snapshots = (Array.isArray(response.snapshots) ? response.snapshots : []).map(normalizeSnapshot);
    set({ loading: false, snapshots });
  },

  createSnapshot: async (payload = {}) => {
    set({ busy: true, error: "", status: "Creating snapshot..." });
    const response = await window.dockium?.snapshots?.create?.(payload);
    if (!response?.ok) {
      set({ busy: false, error: String(response?.error || "Failed to create snapshot"), status: "" });
      return;
    }

    set({ busy: false, status: `Snapshot created: ${String(response?.snapshot?.name || "snapshot")}` });
    const next = await window.dockium?.snapshots?.list?.();
    const snapshots = (Array.isArray(next?.snapshots) ? next.snapshots : []).map(normalizeSnapshot);
    set({ snapshots });
  },

  restoreSnapshot: async (id) => {
    set({ busy: true, error: "", status: "Restoring snapshot..." });
    const response = await window.dockium?.snapshots?.restore?.({ id });
    if (!response?.ok) {
      set({ busy: false, error: String(response?.error || "Failed to restore snapshot"), status: "" });
      return;
    }

    set({ busy: false, status: `Restored: ${String(response?.snapshot?.name || id)}` });
    const next = await window.dockium?.snapshots?.list?.();
    const snapshots = (Array.isArray(next?.snapshots) ? next.snapshots : []).map(normalizeSnapshot);
    set({ snapshots });
  },

  deleteSnapshot: async (id) => {
    set({ busy: true, error: "", status: "Deleting snapshot..." });
    const response = await window.dockium?.snapshots?.delete?.({ id });
    if (!response?.ok) {
      set({ busy: false, error: String(response?.error || "Failed to delete snapshot"), status: "" });
      return;
    }

    const snapshots = (Array.isArray(response.snapshots) ? response.snapshots : []).map(normalizeSnapshot);
    set({ busy: false, status: "Snapshot deleted", snapshots });
  },
}));
