import { create } from "zustand";

const defaultSettings = {
  appTheme: "Dark",
  fontSize: "13px",
  logLevel: "info",
  autoOpenProxy: true,
  scanOnBoot: false,
  proxyPort: 8080,
  interceptByDefault: false,
  sslCertTrust: "Auto install",
  defaultScanMode: "Full",
  payloadIntensity: "Medium",
  timeoutPerRequest: 5000,
  gitBlockCritical: true,
  gitBlockHigh: true,
  gitBlockSecrets: true,
  maxScanDuration: "5 min",
  reportIncludeEvidence: true,
  reportDefaultFormat: "PDF",
  reportLlmEnabled: false,
  reportLlmEndpoint: "https://api.groq.com/openai/v1/chat/completions",
  reportLlmModel: "llama-3.1-8b-instant",
  reportLlmApiKey: "",
  advancedTelemetry: false,
  advancedVerboseIpc: false,
};

export const settingsCategories = [
  "General",
  "Proxy",
  "Scanner",
  "Git Gate",
  "Report",
  "Advanced",
];

export const useSettingsStore = create((set, get) => ({
  activeCategory: "General",
  settings: defaultSettings,
  hydrated: false,
  saveState: "Loading settings...",

  hydrate: async () => {
    const api = window.dockium?.settingsGetAll;
    if (!api) {
      set({ hydrated: true, saveState: "Local mode (IPC unavailable)" });
      return;
    }

    try {
      const loaded = await api();
      set({
        settings: { ...defaultSettings, ...(loaded ?? {}) },
        hydrated: true,
        saveState: "All changes are auto-saved",
      });
    } catch {
      set({ hydrated: true, saveState: "Failed to load settings" });
    }
  },

  setActiveCategory: (category) => {
    set({ activeCategory: category });
  },

  updateSetting: async (key, value) => {
    set((state) => ({
      settings: {
        ...state.settings,
        [key]: value,
      },
      saveState: "Saving...",
    }));

    const api = window.dockium?.settingsUpdate;
    if (!api) {
      set({ saveState: "Saved locally" });
      return;
    }

    try {
      const result = await api({ key, value });
      if (result?.ok) {
        set({
          settings: { ...defaultSettings, ...(result.settings ?? get().settings) },
          saveState: "Saved",
        });
      } else {
        set({ saveState: result?.error ?? "Failed to save" });
      }
    } catch {
      set({ saveState: "Failed to save" });
    }
  },
}));
