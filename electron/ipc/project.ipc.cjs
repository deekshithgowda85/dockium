function registerProjectIpc(ipcMain, deps) {
  const { openProject, openImportedImage, getProjectInfo, getAppMap } = deps;

  ipcMain.handle("project:open", async (_event, payload = {}) => {
    if (!payload.projectPath) {
      return { ok: false, error: "Missing project path" };
    }

    const result = await openProject(payload.projectPath, payload.options || {});
    return { ok: true, ...result };
  });

  ipcMain.handle("project:getInfo", async () => {
    return { ok: true, projectInfo: getProjectInfo() };
  });

  ipcMain.handle("project:openImportedImage", async (_event, payload = {}) => {
    if (!payload.image) {
      return { ok: false, error: "Missing imported image" };
    }

    if (typeof openImportedImage !== "function") {
      return { ok: false, error: "Imported-image project hydration unavailable" };
    }

    const result = await openImportedImage(payload.image, payload.options || {});
    return { ok: true, ...result };
  });

  ipcMain.handle("project:getAppMap", async () => {
    return { ok: true, appMap: getAppMap() };
  });
}

module.exports = { registerProjectIpc };
