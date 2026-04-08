function registerGitIpc(ipcMain, deps) {
  const {
    getProjectPath,
    createGitHookInstaller,
    createGitGate,
    addPushHistory,
    getPushHistory,
    getGateRules,
    setGateRules,
    getWss,
  } = deps;

  ipcMain.handle("git:installHook", async (_event, payload = {}) => {
    const repoPath = payload.repoPath || getProjectPath();
    if (!repoPath) {
      return { ok: false, error: "No repository path" };
    }

    const installer = createGitHookInstaller();
    await installer.install(repoPath);
    getWss()?.emitLog("Git pre-push hook installed");
    return { ok: true };
  });

  ipcMain.handle("git:removeHook", async (_event, payload = {}) => {
    const repoPath = payload.repoPath || getProjectPath();
    if (!repoPath) {
      return { ok: false, error: "No repository path" };
    }

    const installer = createGitHookInstaller();
    await installer.remove(repoPath);
    getWss()?.emitLog("Git pre-push hook removed");
    return { ok: true };
  });

  ipcMain.handle("git:getPushHistory", async () => {
    return { ok: true, history: getPushHistory() };
  });

  ipcMain.handle("git:getGateStatus", async () => {
    const repoPath = getProjectPath();
    let installed = false;
    if (repoPath) {
      const installer = createGitHookInstaller();
      installed = await installer.isInstalled(repoPath);
    }

    return {
      ok: true,
      status: {
        isInstalled: installed,
        pushHistory: getPushHistory(),
        gateRules: getGateRules(),
      },
    };
  });

  ipcMain.handle("git:setGateRules", async (_event, payload = {}) => {
    setGateRules(payload.rules || {});
    return { ok: true, gateRules: getGateRules() };
  });

  ipcMain.handle("git:gateCheck", async (_event, payload = {}) => {
    const repoPath = payload.repoPath || getProjectPath();
    if (!repoPath) {
      return { ok: false, error: "No repository path" };
    }

    const gate = createGitGate(repoPath);
    const result = await gate.check();
    const record = {
      timestamp: new Date().toISOString(),
      branch: payload.branch || "unknown",
      commitSha: payload.commitSha || "unknown",
      result: result.blocked ? "BLOCKED" : "FORWARDED",
      findings: result.findings || [],
      reason: result.reason || "gate-check",
    };

    addPushHistory(record);
    getWss()?.emitLog(`Gate result: ${record.result}`);
    return { ok: true, result: { allowed: !result.blocked, ...result } };
  });
}

module.exports = { registerGitIpc };
