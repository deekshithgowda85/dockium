import { create } from "zustand";

function nodeIdFromPath(pathValue, fallback) {
  return String(pathValue || fallback || "node").replace(/[^a-zA-Z0-9/_-]/g, "_");
}

function normalizeTreeNode(node, parentPath = "") {
  const nodePath = String(node?.path || parentPath || "").replace(/\\/g, "/");
  const type = String(node?.type || "directory").toLowerCase();
  const kind = type === "file" ? "file" : "folder";
  const id = nodeIdFromPath(nodePath || node?.name, `${parentPath}/${node?.name || "node"}`);

  return {
    id,
    name: String(node?.name || ""),
    kind,
    path: nodePath,
    routeCount: Number(node?.routeCount || 0),
    packageName: String(node?.packageName || ""),
    annotation: node?.annotation || null,
    children: Array.isArray(node?.children)
      ? node.children.map((child) => normalizeTreeNode(child, nodePath))
      : [],
  };
}

function normalizeRoute(route, index) {
  return {
    id: route?.id || `route-${index + 1}`,
    method: String(route?.method || "GET").toUpperCase(),
    path: String(route?.path || "/"),
    fullPath: String(route?.fullPath || route?.path || "/"),
    handlerName: String(route?.handlerName || "anonymous-handler"),
    middlewareChain: Array.isArray(route?.middlewareChain) ? route.middlewareChain : [],
    authRequired: Boolean(route?.authRequired),
    authStatus: String(route?.authStatus || (route?.authRequired ? "AUTH REQUIRED" : "PUBLIC")),
    roles: Array.isArray(route?.roles) ? route.roles : [],
    permissions: Array.isArray(route?.permissions) ? route.permissions : [],
    rateLimit: route?.rateLimit || null,
    sourceFile: String(route?.sourceFile || "unresolved"),
    sourceLine: Number(route?.sourceLine || 1),
    packageName: String(route?.packageName || "project"),
    sourceReadable: route?.sourceReadable !== false,
    sourceWarning: String(route?.sourceWarning || ""),
    request: {
      pathParams: Array.isArray(route?.request?.pathParams) ? route.request.pathParams : [],
      queryParams: Array.isArray(route?.request?.queryParams) ? route.request.queryParams : [],
      bodySchema: route?.request?.bodySchema || null,
    },
    response: {
      statusCodes: Array.isArray(route?.response?.statusCodes) ? route.response.statusCodes : [],
      bodySchema: route?.response?.bodySchema || null,
      contentType: String(route?.response?.contentType || "application/json"),
    },
    openApi: route?.openApi || null,
    liveRequest: route?.liveRequest || null,
    liveResponse: route?.liveResponse || null,
  };
}

function normalizeAppMap(rawAppMap = {}) {
  const folderTreeRaw = rawAppMap?.folderTree;
  const folderTree = folderTreeRaw && typeof folderTreeRaw === "object"
    ? normalizeTreeNode(folderTreeRaw)
    : normalizeTreeNode({ name: "project", type: "directory", path: "", children: [] });

  const routes = Array.isArray(rawAppMap?.routeTree)
    ? rawAppMap.routeTree.map(normalizeRoute)
    : [];

  return {
    sourceMode: String(rawAppMap?.sourceMode || "repo"),
    folderTree,
    routes,
    warnings: Array.isArray(rawAppMap?.warnings) ? rawAppMap.warnings : [],
    openApiSummary: String(rawAppMap?.openApiSummary || ""),
    openApiDiagnostics: Array.isArray(rawAppMap?.openApiDiagnostics) ? rawAppMap.openApiDiagnostics : [],
    authInfo: rawAppMap?.authInfo || null,
    linkedSourcePath: String(rawAppMap?.linkedSourcePath || ""),
    packageGroups: Array.isArray(rawAppMap?.packageGroups) ? rawAppMap.packageGroups : [],
    openApiInfo: rawAppMap?.openApiInfo || { title: "", version: "" },
    scannedAt: rawAppMap?.scannedAt || null,
  };
}

function collectExpandedFolders(node, out = {}) {
  if (!node || node.kind !== "folder") {
    return out;
  }

  out[node.id] = true;
  (node.children || []).forEach((child) => collectExpandedFolders(child, out));
  return out;
}

function parseJsonLoose(input, fallback) {
  const raw = String(input || "").trim();
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseHeaders(value) {
  const json = parseJsonLoose(value, null);
  if (json && typeof json === "object" && !Array.isArray(json)) {
    return json;
  }

  const result = {};
  String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) {
        return;
      }
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key) {
        result[key] = val;
      }
    });

  return result;
}

function parseParams(value) {
  const parsed = parseJsonLoose(value, null);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => ({ name: String(item?.name || ""), value: String(item?.value || "") }))
      .filter((item) => item.name);
  }

  return String(value || "")
    .split(/[&\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf("=");
      if (idx === -1) {
        return { name: entry, value: "" };
      }
      return {
        name: entry.slice(0, idx).trim(),
        value: entry.slice(idx + 1).trim(),
      };
    })
    .filter((item) => item.name);
}

function defaultTestDraft(route) {
  const params = Array.isArray(route?.request?.pathParams)
    ? route.request.pathParams.map((item) => `${item.name}=1`).join("\n")
    : "";
  const body = route?.request?.bodySchema ? JSON.stringify(route.request.bodySchema, null, 2) : "{}";
  return {
    open: false,
    loading: false,
    headersText: "{}",
    paramsText: params,
    bodyText: body,
    result: null,
    error: "",
  };
}

function syncDataFromAppMap(set, appMap, scanStatus) {
  const normalized = normalizeAppMap(appMap || {});
  const expandedFolders = collectExpandedFolders(normalized.folderTree, {});
  set((state) => ({
    loading: false,
    error: "",
    folderTree: normalized.folderTree,
    routes: normalized.routes,
    sourceMode: normalized.sourceMode,
    warnings: normalized.warnings,
    openApiSummary: normalized.openApiSummary,
    openApiDiagnostics: normalized.openApiDiagnostics,
    authInfo: normalized.authInfo,
    linkedSourcePath: normalized.linkedSourcePath,
    packageGroups: normalized.packageGroups,
    openApiInfo: normalized.openApiInfo,
    scannedAt: normalized.scannedAt,
    expandedFolders,
    selectedRouteId: state.selectedRouteId && normalized.routes.some((route) => route.id === state.selectedRouteId)
      ? state.selectedRouteId
      : (normalized.routes[0]?.id || null),
    selectedFilePath: state.selectedFilePath || "",
    fileFilterPath: state.fileFilterPath || "",
    scanStatus: scanStatus || state.scanStatus,
  }));
}

const defaultScanStatus = {
  active: false,
  scanId: null,
  startedAt: null,
  completedAt: null,
  lastError: "",
  warnings: [],
  groups: {
    routes: { status: "idle", message: "" },
    tree: { status: "idle", message: "" },
    api: { status: "idle", message: "" },
  },
};

export const useMapStore = create((set, get) => ({
  loading: false,
  error: "",
  folderTree: normalizeTreeNode({ name: "project", type: "directory", path: "", children: [] }),
  routes: [],
  sourceMode: "repo",
  warnings: [],
  openApiSummary: "",
  openApiDiagnostics: [],
  authInfo: null,
  linkedSourcePath: "",
  packageGroups: [],
  openApiInfo: { title: "", version: "" },
  scannedAt: null,
  scanStatus: defaultScanStatus,
  searchQuery: "",
  methodFilter: "ALL",
  authFilter: "ALL",
  tokenInput: "",
  appliedToken: "",
  selectedRouteId: null,
  selectedFilePath: "",
  fileFilterPath: "",
  expandedFolders: {},
  expandedRoutes: {},
  routeTests: {},

  hydrate: async () => {
    set({ loading: true, error: "" });
    try {
      const infoResponse = await window.dockium?.project?.getInfo?.();
      const hasProjectContext = Boolean(infoResponse?.ok && infoResponse?.projectInfo?.projectPath);
      if (!hasProjectContext) {
        set({
          loading: false,
          error: "No project loaded. Open or import a project from New Project Setup.",
        });
        return;
      }

      const response = await window.dockium?.project?.getAppMap?.();
      if (!response?.ok) {
        set({ loading: false, error: String(response?.error || "Failed to load app map") });
        return;
      }
      const savedToken = String(globalThis?.localStorage?.getItem("dockium.appmap.token") || "");
      if (savedToken && !get().appliedToken) {
        set({ tokenInput: savedToken, appliedToken: savedToken });
      }
      syncDataFromAppMap(set, response?.appMap || {}, response?.scanStatus || defaultScanStatus);
    } catch (error) {
      set({ loading: false, error: String(error?.message || "Failed to load app map") });
    }
  },

  startScan: async (authToken) => {
    const token = String((authToken ?? get().appliedToken) || "");
    const response = await window.dockium?.project?.startAppMapScan?.({ authToken: token });
    if (!response?.ok) {
      set({ error: String(response?.error || "Failed to start app map scan") });
      return;
    }
    syncDataFromAppMap(set, response?.appMap || {}, response?.scanStatus || defaultScanStatus);
  },

  refresh: async () => {
    await get().startScan(get().appliedToken);
  },

  applyToken: async () => {
    const token = String(get().tokenInput || "").trim();
    try {
      if (token) {
        globalThis?.localStorage?.setItem("dockium.appmap.token", token);
      } else {
        globalThis?.localStorage?.removeItem("dockium.appmap.token");
      }
    } catch {}
    set({ appliedToken: token });
    await get().startScan(token);
  },

  pollScanStatus: async () => {
    const response = await window.dockium?.project?.getAppMapScanStatus?.();
    if (!response?.ok) {
      return;
    }

    set({ scanStatus: response.scanStatus || defaultScanStatus });
    if (response?.scanStatus?.active === false) {
      await get().hydrate();
    }
  },

  setSearchQuery: (query) => set({ searchQuery: String(query || "") }),
  setMethodFilter: (method) => set({ methodFilter: String(method || "ALL").toUpperCase() }),
  setAuthFilter: (filter) => set({ authFilter: String(filter || "ALL") }),
  setTokenInput: (value) => set({ tokenInput: String(value || "") }),

  toggleFolder: (folderId) => {
    const expanded = get().expandedFolders;
    set({ expandedFolders: { ...expanded, [folderId]: !expanded[folderId] } });
  },

  toggleRouteExpand: (routeId) => {
    const expanded = get().expandedRoutes;
    set({ expandedRoutes: { ...expanded, [routeId]: !expanded[routeId] } });
  },

  selectRoute: (routeId) => {
    const route = get().routes.find((item) => item.id === routeId);
    set({
      selectedRouteId: routeId,
      selectedFilePath: route?.sourceFile || get().selectedFilePath,
    });
  },

  selectFile: (filePath) => {
    const route = get().routes.find((item) => item.sourceFile === filePath);
    set({
      selectedFilePath: filePath,
      fileFilterPath: filePath,
      selectedRouteId: route?.id || get().selectedRouteId,
    });
  },

  clearFileFilter: () => set({ fileFilterPath: "" }),

  updateTestDraft: (routeId, patch) => {
    set((state) => {
      const current = state.routeTests[routeId] || defaultTestDraft(state.routes.find((item) => item.id === routeId));
      return {
        routeTests: {
          ...state.routeTests,
          [routeId]: {
            ...current,
            ...patch,
          },
        },
      };
    });
  },

  toggleTestPanel: (routeId) => {
    set((state) => {
      const route = state.routes.find((item) => item.id === routeId);
      const current = state.routeTests[routeId] || defaultTestDraft(route);
      return {
        routeTests: {
          ...state.routeTests,
          [routeId]: {
            ...current,
            open: !current.open,
          },
        },
      };
    });
  },

  runRouteTest: async (routeId) => {
    const state = get();
    const route = state.routes.find((item) => item.id === routeId);
    if (!route) {
      return;
    }

    const draft = state.routeTests[routeId] || defaultTestDraft(route);
    const headers = parseHeaders(draft.headersText);
    const params = parseParams(draft.paramsText);
    const parsedBody = parseJsonLoose(draft.bodyText, draft.bodyText);

    set((inner) => ({
      routeTests: {
        ...inner.routeTests,
        [routeId]: {
          ...draft,
          loading: true,
          error: "",
        },
      },
    }));

    const response = await window.dockium?.project?.testRoute?.({
      route,
      authToken: state.appliedToken,
      headers,
      params,
      body: parsedBody,
      method: route.method,
    });

    set((inner) => ({
      routeTests: {
        ...inner.routeTests,
        [routeId]: {
          ...draft,
          loading: false,
          error: response?.ok ? "" : String(response?.error || "Route test failed"),
          result: response?.ok ? response.result : null,
        },
      },
    }));
  },
}));
