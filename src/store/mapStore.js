import { create } from "zustand";

const initialExpandedFolders = {};

function annotateFile(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.includes("/api/") || lower.endsWith("route.ts") || lower.endsWith("route.js")) return "ROUTE";
  if (lower.includes("middleware")) return "MIDDLEWARE";
  if (lower.includes("config") || lower.endsWith("settings.py") || lower.includes("vite.config")) return "CONFIG";
  if (lower.includes("migrations")) return "MIGRATION";
  if (lower.includes("test") || lower.includes("spec")) return "TEST";
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) return "COMPONENT";
  if (lower.endsWith(".ts") || lower.endsWith(".js") || lower.endsWith(".py")) return "UTIL";
  return null;
}

function toNodeId(pathValue) {
  return String(pathValue || "node").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function fromFlatToNested(nodes = []) {
  const root = { name: "project", type: "directory", path: "", children: [] };
  const map = new Map([["", root]]);
  const sorted = [...nodes].sort((a, b) => Number(a.depth || 0) - Number(b.depth || 0));

  sorted.forEach((node) => {
    const parts = String(node.path || "").split("/").filter(Boolean);
    if (parts.length === 0) {
      return;
    }

    const parentKey = parts.slice(0, -1).join("/");
    const parent = map.get(parentKey) || root;
    const leaf = parts[parts.length - 1];
    const entry = {
      name: node.type === "directory" ? `${leaf}/` : leaf,
      type: node.type,
      path: node.path,
      annotation: node.annotation || null,
      children: [],
    };

    parent.children.push(entry);
    if (node.type === "directory") {
      map.set(node.path, entry);
    }
  });

  return root;
}

function normalizeTree(rawTree) {
  if (!rawTree) {
    return null;
  }

  if (Array.isArray(rawTree)) {
    if (rawTree.length === 0) {
      return null;
    }

    const looksFlat = rawTree[0] && Object.prototype.hasOwnProperty.call(rawTree[0], "depth");
    if (looksFlat) {
      return fromFlatToNested(rawTree);
    }

    if (rawTree[0] && rawTree[0].type) {
      return {
        name: "project",
        type: "directory",
        path: "",
        children: rawTree,
      };
    }
  }

  if (typeof rawTree === "object") {
    return rawTree;
  }

  return null;
}

function transformTreeNode(node) {
  return {
    id: toNodeId(node.path || node.name),
    name: node.type === "directory" && !String(node.name || "").endsWith("/") ? `${node.name}/` : node.name,
    kind: node.type === "directory" ? "folder" : "file",
    annotation: node.type === "file" ? annotateFile(node.path || node.name) : null,
    children: (node.children || []).map(transformTreeNode),
  };
}

function transformTree(rawTree) {
  const normalized = normalizeTree(rawTree);
  if (!normalized) {
    return [];
  }

  const root = transformTreeNode(normalized);
  if (root.kind === "folder" && Array.isArray(root.children)) {
    return root.children.length > 0 ? root.children : [root];
  }

  return [root];
}

function transformRoutes(routes = []) {
  return routes.map((route, index) => ({
    id: route.id || `route-${index + 1}`,
    method: String(route.method || "GET").toUpperCase(),
    path: route.path || "/",
    auth: Boolean(route.authRequired ?? route.auth),
    params: Array.isArray(route.params) ? route.params.join(",") || "-" : String(route.params || "-"),
    sourceFile: route.sourceFile || route.file || "unknown",
    requestShape: route.requestShape || "{}",
    responseShape: route.responseShape || "{}",
    authRequirements: route.authRequired || route.auth ? "Auth required" : "No auth",
    testPayloads: Array.isArray(route.testPayloads) ? route.testPayloads : [],
  }));
}

function transformApiFlows(rawApiGraph = [], routes = []) {
  const normalizeSchema = (value) => {
    if (!value) {
      return {};
    }

    if (typeof value === "object") {
      return value;
    }

    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return { raw: value };
      }
    }

    return {};
  };

  if (Array.isArray(rawApiGraph) && rawApiGraph.length > 0) {
    return rawApiGraph.map((flow, index) => ({
      id: flow.id || `flow-${index + 1}`,
      method: String(flow.method || String(flow.route || "GET /").split(" ")[0] || "GET").toUpperCase(),
      path: flow.path || String(flow.route || "GET /").split(" ").slice(1).join(" ") || "/",
      requestSchema: normalizeSchema(flow.requestSchema),
      responseSchema: normalizeSchema(flow.responseSchema),
      chain: Array.isArray(flow.callChain) ? flow.callChain : [flow.route || `${flow.method || "GET"} ${flow.path || "/"}`],
    }));
  }

  return routes.map((route, index) => ({
    id: `flow-${index + 1}`,
    method: route.method,
    path: route.path,
    requestSchema: normalizeSchema(route.requestShape),
    responseSchema: normalizeSchema(route.responseShape),
    chain: [
      `${route.method} ${route.path}`,
      `-> source: ${route.sourceFile}`,
      `-> auth: ${route.auth ? "required" : "none"}`,
      "-> service layer",
      "-> response",
    ],
  }));
}

function collectFolderIds(nodes = [], out = {}) {
  nodes.forEach((node) => {
    if (node.kind === "folder") {
      out[node.id] = true;
      collectFolderIds(node.children || [], out);
    }
  });
  return out;
}

export const useMapStore = create((set, get) => ({
  activeTab: "folder-tree",
  loading: false,
  error: "",
  searchQuery: "",
  methodFilter: "ALL",
  folderTree: [],
  routes: [],
  apiFlows: [],
  authBoundaries: [],
  expandedFolders: initialExpandedFolders,
  expandedRouteId: null,
  selectedEndpointId: null,

  hydrate: async () => {
    set({ loading: true, error: "" });
    try {
      const response = await window.dockium?.project?.getAppMap?.();
      const appMap = response?.appMap || {};

      const folderTree = transformTree(appMap.folderTree);
      const routes = transformRoutes(appMap.routeTree || []);
      const apiFlows = transformApiFlows(appMap.apiGraph || [], routes);
      const expanded = collectFolderIds(folderTree, {});

      set({
        loading: false,
        error: "",
        folderTree,
        routes,
        apiFlows,
        authBoundaries: Array.isArray(appMap.authBoundaries) ? appMap.authBoundaries : [],
        expandedFolders: expanded,
        selectedEndpointId: apiFlows[0]?.id || null,
      });
    } catch (error) {
      set({ loading: false, error: String(error?.message || "Failed to load app map") });
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSearchQuery: (query) => set({ searchQuery: String(query || "") }),
  setMethodFilter: (method) => set({ methodFilter: String(method || "ALL").toUpperCase() }),

  toggleFolder: (folderId) => {
    const expanded = get().expandedFolders;
    set({ expandedFolders: { ...expanded, [folderId]: !expanded[folderId] } });
  },

  expandAllFolders: () => {
    set({ expandedFolders: collectFolderIds(get().folderTree, {}) });
  },

  collapseAllFolders: () => {
    set({ expandedFolders: {} });
  },

  toggleRouteDetails: (routeId) => {
    const current = get().expandedRouteId;
    set({ expandedRouteId: current === routeId ? null : routeId });
  },

  selectEndpoint: (endpointId) => set({ selectedEndpointId: endpointId }),
}));
