import { create } from "zustand";

export const useUiStore = create((set, get) => ({
  appMapTab: "graph",
  settingsTab: "general",
  proxyOn: false,
  scanMode: "Full Scan",
  newProjectModalOpen: false,
  onboardingModalOpen: false,
  initialization: {
    active: false,
    message: "",
    needsAi: false,
    startedAt: null,
  },
  toasts: [],
  setAppMapTab: (tab) => set({ appMapTab: tab }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  toggleProxy: async () => {
    const status = await window.dockium?.proxy?.getStatus?.();
    const running = Boolean(status?.status?.running);

    if (running) {
      await window.dockium?.proxy?.stop?.();
      set({ proxyOn: false });
      return;
    }

    await window.dockium?.proxy?.start?.();
    set({ proxyOn: true });
  },
  setScanMode: (mode) => set({ scanMode: mode }),
  openNewProjectModal: () => set({ newProjectModalOpen: true, onboardingModalOpen: true }),
  closeNewProjectModal: () => set({ newProjectModalOpen: false, onboardingModalOpen: false }),
  openOnboardingModal: () => set({ onboardingModalOpen: true, newProjectModalOpen: true }),
  closeOnboardingModal: () => set({ onboardingModalOpen: false, newProjectModalOpen: false }),
  setInitialization: (patch) => {
    set((state) => ({
      initialization: {
        ...state.initialization,
        ...patch,
      },
    }));
  },
  clearInitialization: () => {
    set({ initialization: { active: false, message: "", needsAi: false, startedAt: null } });
  },
  addToast: (payload) => {
    const now = Date.now();
    const toast = {
      id: `toast-${now}-${Math.floor(Math.random() * 1000)}`,
      type: payload?.type || "info",
      title: payload?.title || "Dockium",
      message: payload?.message || "",
      ttlMs: payload?.ttlMs ?? 0,
    };

    set((state) => ({ toasts: [...state.toasts, toast].slice(-5) }));

    if (toast.ttlMs > 0 && payload?.autoDismiss === true) {
      window.setTimeout(() => {
        get().removeToast(toast.id);
      }, toast.ttlMs);
    }

    return toast.id;
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));
