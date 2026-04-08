import { create } from "zustand";

function toSeverityClass(severity) {
  const normalized = String(severity || "medium").toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

function normalizeAlert(alert, index) {
  return {
    id: alert.id || `zap-${Date.now()}-${index}`,
    severity: toSeverityClass(alert.severity),
    name: alert.name || "Unnamed alert",
    endpoint: alert.endpoint || "unknown",
    description: alert.description || "",
    proof: alert.proof || "",
    fix: alert.fix || "",
  };
}

export const useZapStore = create((set, get) => ({
  targetUrl: "",
  status: {
    active: false,
    scanId: null,
    percent: 0,
    startedAt: null,
    completedAt: null,
    lastError: "",
  },
  alerts: [],
  loading: false,

  setTargetUrl: (value) => set({ targetUrl: value }),

  hydrate: async () => {
    const statusResult = await window.dockium?.zap?.getStatus?.();
    if (statusResult?.ok && statusResult.status) {
      set((state) => ({
        status: { ...state.status, ...statusResult.status },
        targetUrl: state.targetUrl || statusResult.status.targetUrl || "",
      }));
    }

    const alertsResult = await window.dockium?.zap?.getAlerts?.();
    if (alertsResult?.ok) {
      set({ alerts: (alertsResult.alerts || []).map(normalizeAlert) });
    }
  },

  applyProgressEvent: (message) => {
    const payload = message?.data || message || {};
    set((state) => ({
      status: {
        ...state.status,
        active: Boolean(payload.active),
        scanId: payload.scanId || state.status.scanId,
        percent: Number(payload.percent || 0),
      },
      targetUrl: payload.targetUrl || state.targetUrl,
    }));
  },

  startScan: async () => {
    const targetUrl = String(get().targetUrl || "").trim();
    set({ loading: true });

    const result = await window.dockium?.zap?.start?.({ targetUrl });
    if (!result?.ok) {
      set((state) => ({
        loading: false,
        status: {
          ...state.status,
          lastError: result?.error || "Failed to start ZAP scan",
        },
      }));
      return;
    }

    set((state) => ({
      loading: false,
      status: { ...state.status, ...(result.status || {}), active: true },
      targetUrl: result?.status?.targetUrl || state.targetUrl,
      alerts: [],
    }));
  },

  pollStatus: async () => {
    const result = await window.dockium?.zap?.getStatus?.();
    if (!result?.ok) {
      return;
    }

    set((state) => ({
      status: { ...state.status, ...(result.status || {}) },
      targetUrl: result?.status?.targetUrl || state.targetUrl,
    }));

    if (result?.status?.active === false && Number(result?.status?.percent || 0) >= 100) {
      await get().loadAlerts();
    }
  },

  loadAlerts: async () => {
    const result = await window.dockium?.zap?.getAlerts?.();
    if (!result?.ok) {
      return;
    }

    set({ alerts: (result.alerts || []).map(normalizeAlert) });
  },

  reset: async () => {
    await window.dockium?.zap?.reset?.();
    set({
      status: {
        active: false,
        scanId: null,
        percent: 0,
        startedAt: null,
        completedAt: null,
        lastError: "",
      },
      alerts: [],
      loading: false,
    });
  },
}));
