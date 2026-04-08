function registerProjectIpc(ipcMain, deps) {
  const {
    openProject,
    openImportedImage,
    getProjectInfo,
    getAppMap,
    getProjectConfig,
    scanAppMap,
    setAppMap,
    testRoute,
  } = deps;

  const scanState = {
    active: false,
    scanId: null,
    startedAt: null,
    completedAt: null,
    lastError: "",
    warnings: [],
    warningSummary: "",
    openApiDiagnostics: [],
    authInfo: null,
    groups: {
      routes: { status: "idle", message: "" },
      tree: { status: "idle", message: "" },
      api: { status: "idle", message: "" },
    },
  };

  function fail(error, code, detail) {
    return {
      ok: false,
      error: String(error || "Request failed"),
      code: Number(code || 500),
      detail: String(detail || ""),
    };
  }

  function snapshot() {
    return {
      active: scanState.active,
      scanId: scanState.scanId,
      startedAt: scanState.startedAt,
      completedAt: scanState.completedAt,
      lastError: scanState.lastError,
      warnings: scanState.warnings,
      warningSummary: scanState.warningSummary,
      openApiDiagnostics: scanState.openApiDiagnostics,
      authInfo: scanState.authInfo,
      groups: scanState.groups,
    };
  }

  ipcMain.handle("project:open", async (_event, payload = {}) => {
    if (!payload.projectPath) {
      return fail("Missing project path", 400, "projectPath is required");
    }

    const result = await openProject(payload.projectPath, payload.options || {});
    return { ok: true, ...result };
  });

  ipcMain.handle("project:getInfo", async () => {
    return { ok: true, projectInfo: getProjectInfo() };
  });

  ipcMain.handle("project:openImportedImage", async (_event, payload = {}) => {
    if (!payload.image) {
      return fail("Missing imported image", 400, "image is required");
    }

    if (typeof openImportedImage !== "function") {
      return fail("Imported-image project hydration unavailable", 503, "openImportedImage is not configured");
    }

    const result = await openImportedImage(payload.image, payload.options || {});
    return { ok: true, ...result };
  });

  ipcMain.handle("project:getAppMap", async () => {
    return { ok: true, appMap: getAppMap(), scanStatus: snapshot() };
  });

  ipcMain.handle("project:startAppMapScan", async (_event, payload = {}) => {
    if (scanState.active) {
      return { ok: true, scanStatus: snapshot(), appMap: getAppMap() };
    }

    const config = getProjectConfig?.();
    if (!config?.project?.targetUrl) {
      scanState.lastError = "No project loaded. Open or import a project first.";
      return fail(
        scanState.lastError,
        400,
        "project:startAppMapScan requires an active project context"
      );
    }

    if (typeof scanAppMap !== "function") {
      return fail("Runtime app-map scanner unavailable", 503, "scanAppMap dependency is missing");
    }

    scanState.active = true;
    scanState.scanId = `appmap-${Date.now()}`;
    scanState.startedAt = new Date().toISOString();
    scanState.completedAt = null;
    scanState.lastError = "";
    scanState.warnings = [];
    scanState.warningSummary = "";
    scanState.openApiDiagnostics = [];
    scanState.authInfo = null;
    scanState.groups = {
      routes: { status: "loading", message: "Discovering runtime routes" },
      tree: { status: "idle", message: "" },
      api: { status: "idle", message: "" },
    };

    Promise.resolve()
      .then(async () => {
        const config = getProjectConfig?.();
        const targetUrl = String(config?.project?.targetUrl || "").trim();
        const appMap = await scanAppMap({
          authToken: String(payload?.authToken || ""),
          sourceRepoPath: String(payload?.sourceRepoPath || ""),
          targetUrl,
          onProgress: (event) => {
            const group = String(event?.group || "routes");
            if (!scanState.groups[group]) {
              return;
            }

            scanState.groups[group] = {
              status: String(event?.status || "loading"),
              message: String(event?.message || ""),
            };
          },
        });

        setAppMap?.(appMap);
        scanState.warnings = Array.isArray(appMap?.warnings) ? appMap.warnings : [];
        scanState.warningSummary = String(appMap?.openApiSummary || scanState.warnings[0] || "");
        scanState.openApiDiagnostics = Array.isArray(appMap?.openApiDiagnostics)
          ? appMap.openApiDiagnostics
          : [];
        scanState.authInfo = appMap?.authInfo || null;
      })
      .catch((error) => {
        scanState.lastError = String(error?.message || "App map scan failed");
      })
      .finally(() => {
        scanState.active = false;
        scanState.completedAt = new Date().toISOString();

        for (const group of Object.keys(scanState.groups)) {
          if (scanState.groups[group].status === "loading") {
            scanState.groups[group].status = scanState.lastError ? "error" : "done";
          }
        }
      });

    return { ok: true, scanStatus: snapshot(), appMap: getAppMap() };
  });

  ipcMain.handle("project:getAppMapScanStatus", async () => {
    return { ok: true, scanStatus: snapshot() };
  });

  ipcMain.handle("project:testRoute", async (_event, payload = {}) => {
    if (typeof testRoute !== "function") {
      return fail("Route test runner unavailable", 503, "testRoute dependency is missing");
    }

    if (!payload?.route || typeof payload.route !== "object") {
      return fail("Missing route payload", 400, "route is required");
    }

    const authToken = String(payload?.authToken || "").trim();
    const extraHeaders = payload?.headers && typeof payload.headers === "object" ? payload.headers : {};
    const authHeaders = { ...extraHeaders };

    if (authToken) {
      if (/^bearer\s+/i.test(authToken)) {
        authHeaders.Authorization = authToken;
      } else if (authToken.includes("=") && authToken.includes(";")) {
        authHeaders.Cookie = authToken;
      } else {
        authHeaders.Authorization = `Bearer ${authToken}`;
      }
    }

    const params = Array.isArray(payload?.params) ? payload.params : [];
    const body = payload?.body;
    const method = String(payload?.method || payload?.route?.method || "GET").toUpperCase();

    const response = await testRoute(payload.route, {
      authHeaders,
      headers: extraHeaders,
      params,
      body,
      method,
    });
    if (response?.ok === false) {
      return fail(response.error || "Route test failed", response.code || 500, response.detail || "project:testRoute");
    }

    return {
      ok: true,
      result: response?.route || null,
    };
  });
}

module.exports = { registerProjectIpc };
