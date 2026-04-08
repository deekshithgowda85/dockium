function registerProxyIpc(ipcMain, deps) {
  const { ensureProxyEngine, getProxyEngine, getWss } = deps;

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

    await engine.stop();
    getWss()?.emitLog("Proxy stopped");
    return { ok: true, status: { running: false } };
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
    const status = engine ? engine.getStatus() : { running: false, requestCount: 0, port: 8080 };

    return {
      ok: true,
      status,
    };
  });
}

module.exports = { registerProxyIpc };
