const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function safeName(value) {
  return String(value || "dockium")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "dockium";
}

async function writeSnapshotFiles(projectInfo, requests) {
  const projectName = safeName(projectInfo?.name || "dockium");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folder = path.join(os.homedir(), "Downloads", "DockiumReports", projectName, "proxy");
  await fs.mkdir(folder, { recursive: true });

  const jsonFile = path.join(folder, `proxy-snapshot-${stamp}.json`);
  const ndjsonFile = path.join(folder, `proxy-snapshot-${stamp}.ndjson`);

  const envelope = {
    generatedAt: new Date().toISOString(),
    projectName,
    count: requests.length,
    requests,
  };

  await fs.writeFile(jsonFile, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  const ndjsonBody = requests.map((entry) => JSON.stringify(entry)).join("\n");
  await fs.writeFile(ndjsonFile, `${ndjsonBody}\n`, "utf8");

  return {
    count: requests.length,
    filePath: jsonFile,
    ndjsonPath: ndjsonFile,
    directory: folder,
  };
}

function registerProxyIpc(ipcMain, deps) {
  const { ensureProxyEngine, getProxyEngine, getWss, getProjectInfo } = deps;

  ipcMain.handle("proxy:start", async (_event, payload = {}) => {
    const engine = ensureProxyEngine(payload.config || {});
    await engine.start();
    getWss()?.emitLog("Proxy started");
    return { ok: true, status: { running: true, port: payload.port || 8080 } };
  });

  ipcMain.handle("proxy:stop", async () => {
    const engine = getProxyEngine();
    if (!engine) {
      return { ok: true, status: { running: false } };
    }

    const snapshot = engine.getRequests();

    await engine.stop();
    getWss()?.emitLog("Proxy stopped");

    let autoExport = null;
    if (Array.isArray(snapshot) && snapshot.length > 0) {
      try {
        autoExport = await writeSnapshotFiles(getProjectInfo?.() || {}, snapshot);
        getWss()?.emitLog(`Proxy snapshot auto-saved (${snapshot.length} requests) -> ${autoExport.filePath}`);
      } catch (error) {
        getWss()?.emitLog(`Proxy snapshot auto-save failed: ${error.message}`, "warn");
      }
    }

    return { ok: true, status: { running: false }, autoExport };
  });

  ipcMain.handle("proxy:getRequests", async () => {
    const engine = getProxyEngine();
    const requests = engine ? engine.getRequests() : [];
    return { ok: true, requests };
  });

  ipcMain.handle("proxy:clearRequests", async () => {
    const engine = getProxyEngine();
    if (engine) {
      engine.clearRequests();
    }
    return { ok: true };
  });

  ipcMain.handle("proxy:replay", async (_event, payload = {}) => {
    const request = payload.request;
    if (!request) {
      return { ok: false, error: "Missing request payload" };
    }

    const engine = getProxyEngine();
    if (!engine) {
      return { ok: false, error: "Proxy engine is not running" };
    }

    const replayed = await engine.replay(request, payload.modifications || {});

    return {
      ok: true,
      replayed,
    };
  });

  ipcMain.handle("proxy:getStatus", async () => {
    const engine = getProxyEngine();
    const status = engine
      ? engine.getStatus()
      : { running: false, intercepting: false, requestCount: 0, port: 8080 };

    return {
      ok: true,
      status,
    };
  });

  ipcMain.handle("proxy:setIntercept", async (_event, payload = {}) => {
    const engine = getProxyEngine();
    if (!engine) {
      return { ok: false, error: "Proxy engine is not running" };
    }

    const enabled = Boolean(payload.enabled);
    engine.setIntercepting(enabled);
    return { ok: true, status: engine.getStatus() };
  });

  ipcMain.handle("proxy:exportSnapshot", async (_event, payload = {}) => {
    const engine = getProxyEngine();
    const requests = engine ? engine.getRequests() : [];
    if (!Array.isArray(requests) || requests.length === 0) {
      return { ok: false, error: "No proxy requests available to export" };
    }

    const exported = await writeSnapshotFiles(getProjectInfo?.() || {}, requests);

    getWss()?.emitLog(`Proxy snapshot exported (${requests.length} requests) -> ${exported.filePath}`);
    return {
      ok: true,
      ...exported,
    };
  });
}

module.exports = { registerProxyIpc };
