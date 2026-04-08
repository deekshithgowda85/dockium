import { create } from "zustand";

function toRequestRaw(request) {
  if (request.requestRaw) {
    return request.requestRaw;
  }

  return `${request.method || "GET"} ${request.path || "/"} HTTP/1.1\nHost: ${request.host || "localhost"}`;
}

function toResponseRaw(request) {
  if (request.responseRaw) {
    return request.responseRaw;
  }

  const status = request.status || 0;
  return `HTTP/1.1 ${status} ${status >= 400 ? "ERROR" : "OK"}`;
}

function normalize(request) {
  return {
    id: Number(request.id) || Date.now(),
    method: String(request.method || "GET").toUpperCase(),
    host: request.host || "localhost",
    path: request.path || "/",
    status: Number(request.status || request.responseStatus || 0),
    timeMs: Number(request.timeMs || request.durationMs || 0),
    flag: request.flag || "--",
    requestRaw: toRequestRaw(request),
    responseRaw: toResponseRaw(request),
  };
}

export const useProxyStore = create((set, get) => ({
  proxyEnabled: false,
  interceptEnabled: false,
  filterText: "",
  requests: [],
  selectedRequestId: null,

  hydrate: async () => {
    const status = await window.dockium?.proxy?.getStatus?.();
    const response = await window.dockium?.proxy?.getRequests?.();
    const requests = (response?.requests || []).map(normalize);

    set({
      proxyEnabled: Boolean(status?.status?.running),
      requests,
      selectedRequestId: requests[0]?.id || null,
    });
  },

  setFilterText: (value) => set({ filterText: value }),

  toggleProxyEnabled: async () => {
    const enabled = get().proxyEnabled;
    if (enabled) {
      await window.dockium?.proxy?.stop?.();
      set({ proxyEnabled: false });
      return;
    }

    await window.dockium?.proxy?.start?.();
    set({ proxyEnabled: true });
    await get().hydrate();
  },

  toggleInterceptEnabled: () => {
    set((state) => ({ interceptEnabled: !state.interceptEnabled }));
  },

  clearRequests: async () => {
    await window.dockium?.proxy?.clearRequests?.();
    set({ requests: [], selectedRequestId: null });
  },

  selectRequest: (id) => {
    set({ selectedRequestId: id });
  },

  updateSelectedRequestRaw: (raw) => {
    const { selectedRequestId } = get();
    if (!selectedRequestId) {
      return;
    }

    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === selectedRequestId ? { ...request, requestRaw: raw } : request,
      ),
    }));
  },

  replaySelectedRequest: async () => {
    const { selectedRequestId, requests } = get();
    const selected = requests.find((request) => request.id === selectedRequestId);
    if (!selected) {
      return;
    }

    const replay = await window.dockium?.proxy?.replay?.({ request: selected });
    const replayed = replay?.replayed ? normalize(replay.replayed) : { ...selected, id: Date.now(), path: `${selected.path} (replayed)` };

    set((state) => ({
      requests: [...state.requests, replayed].slice(-10000),
      selectedRequestId: replayed.id,
    }));
  },

  forwardSelected: () => {
    const { selectedRequestId } = get();
    if (!selectedRequestId) {
      return;
    }

    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === selectedRequestId ? { ...request, flag: "--" } : request,
      ),
    }));
  },

  dropSelected: () => {
    const { selectedRequestId, requests } = get();
    if (!selectedRequestId) {
      return;
    }

    const index = requests.findIndex((request) => request.id === selectedRequestId);
    const next = requests.filter((request) => request.id !== selectedRequestId);
    const fallback = next[index]?.id ?? next[index - 1]?.id ?? null;

    set({ requests: next, selectedRequestId: fallback });
  },
}));
