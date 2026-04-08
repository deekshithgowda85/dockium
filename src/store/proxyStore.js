import { create } from "zustand";

function toRequestRaw(request) {
  if (request.requestRaw) {
    return request.requestRaw;
  }

  const headers = request.requestHeaders && typeof request.requestHeaders === "object"
    ? Object.entries(request.requestHeaders).map(([key, value]) => `${key}: ${value}`).join("\n")
    : `Host: ${request.host || "localhost"}`;
  const body = String(request.requestBody || "");
  return `${request.method || "GET"} ${request.path || "/"} HTTP/1.1\n${headers}${body ? `\n\n${body}` : ""}`;
}

function toResponseRaw(request) {
  if (request.responseRaw) {
    return request.responseRaw;
  }

  const status = request.status || 0;
  const headers = request.responseHeaders && typeof request.responseHeaders === "object"
    ? Object.entries(request.responseHeaders).map(([key, value]) => `${key}: ${value}`).join("\n")
    : "";
  const body = String(request.responseBody || "");
  return `HTTP/1.1 ${status} ${status >= 400 ? "ERROR" : "OK"}${headers ? `\n${headers}` : ""}${body ? `\n\n${body}` : ""}`;
}

function normalize(request) {
  return {
    id: Number(request.id) || Date.now(),
    method: String(request.method || "GET").toUpperCase(),
    host: request.host || "localhost",
    path: request.path || "/",
    status: Number(request.status || request.responseStatus || 0),
    timeMs: Number(request.timeMs || request.durationMs || 0),
    direction: String(request.direction || "in-out"),
    requestFormat: String(request.requestFormat || "unknown"),
    responseFormat: String(request.responseFormat || "unknown"),
    requestBytes: Number(request.requestBytes || 0),
    responseBytes: Number(request.responseBytes || 0),
    timestamp: String(request.timestamp || ""),
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
  exportInfo: {
    loading: false,
    ok: false,
    filePath: "",
    detail: "",
  },

  hydrate: async () => {
    const status = await window.dockium?.proxy?.getStatus?.();
    const response = await window.dockium?.proxy?.getRequests?.();
    const requests = (response?.requests || []).map(normalize);

    set({
      proxyEnabled: Boolean(status?.status?.running),
      interceptEnabled: Boolean(status?.status?.intercepting),
      requests,
      selectedRequestId: requests[0]?.id || null,
    });
  },

  setFilterText: (value) => set({ filterText: value }),

  toggleProxyEnabled: async () => {
    const enabled = get().proxyEnabled;
    if (enabled) {
      const stopResult = await window.dockium?.proxy?.stop?.();
      set({
        proxyEnabled: false,
        exportInfo: stopResult?.autoExport
          ? {
              loading: false,
              ok: true,
              filePath: String(stopResult.autoExport.filePath || ""),
              detail: `Auto-saved ${Number(stopResult.autoExport.count || 0)} requests to ${stopResult.autoExport.filePath}`,
            }
          : get().exportInfo,
      });
      return;
    }

    await window.dockium?.proxy?.start?.();
    set({ proxyEnabled: true });
    await get().hydrate();
  },

  toggleInterceptEnabled: async () => {
    const next = !get().interceptEnabled;
    const response = await window.dockium?.proxy?.setIntercept?.({ enabled: next });
    if (!response?.ok) {
      return;
    }
    set({ interceptEnabled: Boolean(response?.status?.intercepting) });
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

  exportSnapshot: async () => {
    set((state) => ({
      exportInfo: {
        ...state.exportInfo,
        loading: true,
      },
    }));

    const response = await window.dockium?.proxy?.exportSnapshot?.();
    if (!response?.ok) {
      set({
        exportInfo: {
          loading: false,
          ok: false,
          filePath: "",
          detail: String(response?.error || "Export failed"),
        },
      });
      return;
    }

    set({
      exportInfo: {
        loading: false,
        ok: true,
        filePath: String(response.filePath || ""),
        detail: `Saved ${Number(response.count || 0)} requests to ${response.filePath}`,
      },
    });
  },
}));
