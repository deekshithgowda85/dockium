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
    name: finding.title || finding.name || "Unnamed Artemis finding",
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
    targetUrl: "",
    percent: 0,
    phaseName: "idle",
    startedAt: null,
    completedAt: null,
    lastError: "",
    preflight: null,
    diagnostics: {
      templateSetup: null,
      candidates: [],
    },
  },
  findings: [],
  loading: false,

  setTargetUrl: (value) => set({ targetUrl: value }),

  resolveProjectTargetUrl: async () => {
    const infoResult = await window.dockium?.project?.getInfo?.();
    if (!infoResult?.ok) {
      return "";
    }
    return String(infoResult?.projectInfo?.targetUrl || "").trim();
  },

  hydrate: async () => {
    const statusResult = await window.dockium?.nuclei?.getStatus?.();
    const projectTargetUrl = await get().resolveProjectTargetUrl();

    if (statusResult?.ok && statusResult.status) {
      set((state) => ({
        status: { ...state.status, ...statusResult.status },
        targetUrl: state.targetUrl || statusResult.status.targetUrl || projectTargetUrl || "",
      }));
    } else if (projectTargetUrl) {
      set((state) => ({
        targetUrl: state.targetUrl || projectTargetUrl,
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
        targetUrl: payload.targetUrl || state.status.targetUrl,
        percent: Number(payload.percent || 0),
        phaseName: payload.phaseName || state.status.phaseName,
        startedAt: payload.startedAt || state.status.startedAt,
        completedAt: payload.completedAt || state.status.completedAt,
        lastError: payload.lastError || "",
        preflight: payload.preflight || state.status.preflight,
        diagnostics: payload.diagnostics || state.status.diagnostics,
      },
      targetUrl: payload.targetUrl || state.targetUrl,
    }));
  },

  startScan: async (forceScannerRecreate = false) => {
    set({ loading: true });

    let targetUrl = String(get().targetUrl || "").trim();
    if (!targetUrl) {
      targetUrl = await get().resolveProjectTargetUrl();
    }

    if (!window.dockium?.nuclei?.start) {
      set((state) => ({
        loading: false,
        status: {
          ...state.status,
          lastError: "Artemis start API unavailable in preload bridge",
        },
      }));
      return;
    }

    try {
      const result = await window.dockium.nuclei.start({
        targetUrl,
        forceScannerRecreate: Boolean(forceScannerRecreate),
      });
      if (!result?.ok) {
        const detail = [result?.error, result?.detail].filter(Boolean).join(" | ");
        set((state) => ({
          loading: false,
          status: {
            ...state.status,
            lastError: detail || "Failed to start Artemis scan",
          },
        }));
        return;
      }

      set((state) => ({
        loading: false,
        status: {
          ...state.status,
          ...(result.status || {}),
          active: true,
          lastError: "",
          preflight: result?.status?.preflight || null,
          diagnostics: result?.status?.diagnostics || state.status.diagnostics,
        },
        targetUrl: result?.status?.targetUrl || targetUrl || state.targetUrl,
        findings: [],
      }));
    } catch (error) {
      set((state) => ({
        loading: false,
        status: {
          ...state.status,
          lastError: String(error?.message || "Failed to start Artemis scan"),
        },
      }));
    }
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
        targetUrl: "",
        percent: 0,
        phaseName: "idle",
        startedAt: null,
        completedAt: null,
        lastError: "",
        preflight: null,
        diagnostics: {
          templateSetup: null,
          candidates: [],
        },
      },
      findings: [],
      loading: false,
    });
  },
}));
