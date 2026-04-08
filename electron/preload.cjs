const { contextBridge, ipcRenderer } = require("electron");

const WS_URL = "ws://127.0.0.1:4242";

let ws = null;
let reconnectTimer = null;
let retries = 0;
const maxRetries = 10;
const backoffMs = 2000;

const listeners = {
  log: new Set(),
  finding: new Set(),
  container: new Set(),
  request: new Set(),
  scan_progress: new Set(),
  scan_complete: new Set(),
  nuclei_progress: new Set(),
  fleet: new Set(),
  gate_result: new Set(),
};

function dispatchEvent(type, payload) {
  const handlers = listeners[type];
  if (!handlers) {
    return;
  }

  handlers.forEach((handler) => {
    try {
      handler(payload);
    } catch {}
  });
}

function scheduleReconnect() {
  if (retries >= maxRetries) {
    return;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  reconnectTimer = setTimeout(() => {
    connectWs();
  }, backoffMs);
}

function connectWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    retries = 0;
  };

  ws.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "scan-progress") {
      dispatchEvent("scan_progress", message);
      return;
    }

    if (message.type === "container-status") {
      dispatchEvent("container", message);
      return;
    }

    dispatchEvent(message.type, message);
  };

  ws.onerror = () => {
    retries += 1;
  };

  ws.onclose = () => {
    retries += 1;
    scheduleReconnect();
  };
}

function subscribe(type, callback) {
  if (!listeners[type]) {
    return () => {};
  }

  listeners[type].add(callback);
  connectWs();

  return () => {
    listeners[type].delete(callback);
  };
}

async function invoke(channel, payload) {
  try {
    return await ipcRenderer.invoke(channel, payload);
  } catch (error) {
    const message = String(error?.message || "IPC invoke failed");
    return {
      ok: false,
      error: message,
      code: /no handler registered/i.test(message) ? 503 : 500,
      detail: `channel=${channel}`,
    };
  }
}

const api = {
  platform: process.platform,

  menu: {
    onNavigate: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }

      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("menu:navigate", listener);
      return () => ipcRenderer.removeListener("menu:navigate", listener);
    },
  },

  window: {
    minimize: () => invoke("window:minimize"),
    toggleMaximize: () => invoke("window:toggle-maximize"),
    isMaximized: () => invoke("window:is-maximized"),
    close: () => invoke("window:close"),
    openExternal: (url) => invoke("window:openExternal", { url }),
    onMaximizeChanged: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }

      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("window:maximize-changed", listener);
      return () => ipcRenderer.removeListener("window:maximize-changed", listener);
    },
  },

  docker: {
    startAll: () => invoke("docker:startAll"),
    stopAll: () => invoke("docker:stopAll"),
    getStatus: () => invoke("docker:getStatus"),
    getStats: () => invoke("docker:getStats"),
    importByUrl: (payload) => invoke("docker:importByUrl", payload),
    getRecentImports: () => invoke("docker:getRecentImports"),
  },

  scan: {
    start: (payload) => invoke("scan:start", payload),
    stop: () => invoke("scan:stop"),
    getFindings: () => invoke("scan:getFindings"),
    getStatus: () => invoke("scan:getStatus"),
  },

  nuclei: {
    start: (payload) => invoke("nuclei:start", payload),
    getStatus: () => invoke("nuclei:getStatus"),
    getFindings: () => invoke("nuclei:getFindings"),
    reset: () => invoke("nuclei:reset"),
  },

  git: {
    installHook: (payload) => invoke("git:installHook", payload),
    removeHook: (payload) => invoke("git:removeHook", payload),
    getPushHistory: () => invoke("git:getPushHistory"),
    getGateStatus: () => invoke("git:getGateStatus"),
    setGateRules: (payload) => invoke("git:setGateRules", payload),
    gateCheck: (payload) => invoke("git:gateCheck", payload),
  },

  proxy: {
    start: (payload) => invoke("proxy:start", payload),
    stop: () => invoke("proxy:stop"),
    getRequests: () => invoke("proxy:getRequests"),
    replay: (payload) => invoke("proxy:replay", payload),
    clearRequests: () => invoke("proxy:clearRequests"),
    getStatus: () => invoke("proxy:getStatus"),
  },

  fleet: {
    start: (payload) => invoke("fleet:start", payload),
    stop: () => invoke("fleet:stop"),
    getStatus: () => invoke("fleet:getStatus"),
  },

  project: {
    open: (payload) => invoke("project:open", payload),
    openImportedImage: (payload) => invoke("project:openImportedImage", payload),
    getInfo: () => invoke("project:getInfo"),
    getAppMap: () => invoke("project:getAppMap"),
  },

  report: {
    getLatest: () => invoke("report:getLatest"),
    exportPdf: () => invoke("report:exportPdf"),
    exportMarkdown: (payload) => invoke("report:exportMarkdown", payload),
    exportJson: (payload) => invoke("report:exportJson", payload),
  },

  settings: {
    getAll: () => invoke("settings:get-all"),
    set: (payload) => invoke("settings:update", payload),
  },

  ws: {
    connect: () => connectWs(),
    onFinding: (callback) => subscribe("finding", callback),
    onLog: (callback) => subscribe("log", callback),
    onContainerUpdate: (callback) => subscribe("container", callback),
    onRequest: (callback) => subscribe("request", callback),
    onScanProgress: (callback) => subscribe("scan_progress", callback),
    onScanComplete: (callback) => subscribe("scan_complete", callback),
    onNucleiProgress: (callback) => subscribe("nuclei_progress", callback),
    onFleet: (callback) => subscribe("fleet", callback),
  },

  // Backward-compatible aliases used by existing renderer.
  exportReport: (payload) => invoke("report:export", payload),
  settingsGetAll: () => invoke("settings:get-all"),
  settingsUpdate: (payload) => invoke("settings:update", payload),
  onboardingGetState: () => invoke("onboarding:get-state"),
  onboardingSetState: (payload) => invoke("onboarding:set-state", payload),
  onboardingDetectProject: (payload) => invoke("onboarding:detect-project", payload),
  onboardingBrowseProject: () => invoke("onboarding:browse-project"),
  projectOpen: (projectPath, options = {}) => invoke("project:open", { projectPath, options }),
  projectOpenImportedImage: (image, options = {}) =>
    invoke("project:openImportedImage", { image, options }),
};

contextBridge.exposeInMainWorld("dockium", api);
