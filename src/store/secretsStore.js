import { create } from "zustand";

function normalizeSeverity(value) {
  const text = String(value || "info").toLowerCase();
  if (["critical", "high", "medium", "low", "info"].includes(text)) {
    return text;
  }
  return "info";
}

function normalizeFinding(finding, index) {
  return {
    id: String(finding?.id || `secret-${index + 1}`),
    type: String(finding?.type || "Potential secret"),
    valuePreview: String(finding?.valuePreview || "masked"),
    location: String(finding?.location || "unknown"),
    state: String(finding?.state || "Current scan"),
    severity: normalizeSeverity(finding?.severity),
    source: String(finding?.source || "scan"),
    detectedAt: String(finding?.detectedAt || new Date().toISOString()),
    detail: String(finding?.detail || "Potential secret exposed"),
  };
}

function summarize(findings = []) {
  const summary = { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) {
    const severity = normalizeSeverity(finding?.severity);
    summary.total += 1;
    summary[severity] += 1;
  }
  return summary;
}

export const useSecretsStore = create((set, get) => ({
  loading: false,
  rescanning: false,
  error: "",
  findings: [],
  summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  lastUpdated: "",

  hydrate: async () => {
    set({ loading: true, error: "" });
    const response = await window.dockium?.secrets?.getFindings?.();
    if (!response?.ok) {
      set({ loading: false, error: String(response?.error || "Failed to load secrets") });
      return;
    }

    const findings = (Array.isArray(response.findings) ? response.findings : []).map(normalizeFinding);
    const summary = response.summary || summarize(findings);

    set({
      loading: false,
      error: "",
      findings,
      summary,
      lastUpdated: String(response.generatedAt || new Date().toISOString()),
    });
  },

  rescan: async () => {
    set({ rescanning: true, error: "" });
    const result = await window.dockium?.scan?.start?.({ mode: "quick", modules: ["secrets"] });
    if (!result?.ok) {
      set({ rescanning: false, error: String(result?.error || "Secrets rescan failed") });
      return;
    }

    await get().hydrate();
    set({ rescanning: false });
  },
}));
