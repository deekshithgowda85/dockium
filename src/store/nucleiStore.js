import { create } from "zustand";

function toSeverityClass(severity) {
  const normalized = String(severity || "medium").toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  if (normalized === "low") return "low";
  return "info";
}

function normalizeFinding(finding, index) {
  return {
    id: finding.id || `nuclei-${Date.now()}-${index}`,
    severity: toSeverityClass(finding.severity),
    name: finding.title || finding.name || "Unnamed Nuclei finding",
    endpoint: finding.endpoint || finding.url || "unknown",
    description: finding.description || finding.what || "",
    proof: finding.proof || "",
    fix: finding.fix || finding.solution || "",
    templateId: finding.payload || "n/a",
  };
}

export const useNucleiStore = create((set, get) => ({
  targetUrl: "",
  status: {
    active: false,
    scanId: null,
    percent: 0,
    phaseName: "idle",
    startedAt: null,
    completedAt: null,
    lastError: "",
  },
  findings: [],
  loading: false,

  setTargetUrl: (value) => set({ targetUrl: value }),

  hydrate: async () => {
    const statusResult = await window.dockium?.nuclei?.getStatus?.();
    if (statusResult?.ok && statusResult.status) {
      set((state) => ({
        status: { ...state.status, ...statusResult.status },
        targetUrl: state.targetUrl || statusResult.status.targetUrl || "",
      }));
    }

    const findingsResult = await window.dockium?.nuclei?.getFindings?.();
    if (findingsResult?.ok) {
      set({ findings: (findingsResult.findings || []).map(normalizeFinding) });
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
        phaseName: payload.phaseName || state.status.phaseName,
        startedAt: payload.startedAt || state.status.startedAt,
        completedAt: payload.completedAt || state.status.completedAt,
        lastError: payload.lastError || "",
      },
      targetUrl: payload.targetUrl || state.targetUrl,
    }));
  },

  startScan: async () => {
    const targetUrl = String(get().targetUrl || "").trim();
    set({ loading: true });

    const result = await window.dockium?.nuclei?.start?.({ targetUrl });
    if (!result?.ok) {
      set((state) => ({
        loading: false,
        status: {
          ...state.status,
          lastError: result?.error || "Failed to start Nuclei scan",
        },
      }));
      return;
    }

    set((state) => ({
      loading: false,
      status: { ...state.status, ...(result.status || {}), active: true },
      targetUrl: result?.status?.targetUrl || state.targetUrl,
      findings: [],
    }));
  },

  pollStatus: async () => {
    const result = await window.dockium?.nuclei?.getStatus?.();
    if (!result?.ok) {
      return;
    }

    set((state) => ({
      status: { ...state.status, ...(result.status || {}) },
      targetUrl: result?.status?.targetUrl || state.targetUrl,
    }));

    if (result?.status?.active === false) {
      await get().loadFindings();
    }
  },

  loadFindings: async () => {
    const result = await window.dockium?.nuclei?.getFindings?.();
    if (!result?.ok) {
      return;
    }

    set({ findings: (result.findings || []).map(normalizeFinding) });
  },

  reset: async () => {
    const result = await window.dockium?.nuclei?.reset?.();
    if (result?.ok === false) {
      set((state) => ({
        status: {
          ...state.status,
          lastError: result?.error || "Reset failed",
        },
      }));
      return;
    }

    set({
      status: {
        active: false,
        scanId: null,
        percent: 0,
        phaseName: "idle",
        startedAt: null,
        completedAt: null,
        lastError: "",
      },
      findings: [],
      loading: false,
    });
  },
}));
