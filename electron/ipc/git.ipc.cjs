const fs = require("fs");
const path = require("path");

function toPushRecord(result = {}, branch = "unknown") {
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  const blocked = Boolean(result?.blocked === true || result?.allowed === false);
  const durationMs = Number(result?.durationMs || 0);

  return {
    id: Number(result?.id || Date.now()),
    timestamp: result?.timestamp || new Date().toISOString(),
    branch: String(result?.branch || branch || "unknown"),
    commitSha: String(result?.commitSha || "unknown"),
    commitMessage: String(result?.commitMessage || "-"),
    result: blocked ? "BLOCKED" : "FORWARDED",
    findings,
    reason: String(result?.reason || (blocked ? "Gate blocked" : "Gate passed")),
    testsPassed: Boolean(result?.testsPassed !== false),
    durationMs,
    duration: durationMs > 0 ? `${(durationMs / 1000).toFixed(1)}s` : "-",
    changedFiles: Array.isArray(result?.changedFiles) ? result.changedFiles : [],
    diffString: String(result?.diffString || ""),
    newRoutes: Array.isArray(result?.newRoutes) ? result.newRoutes : [],
    reportPath: String(result?.reportPath || ""),
  };
}

function loadHistoryReports(repoPath) {
  if (!repoPath) {
    return [];
  }

  const reportsDir = path.join(repoPath, ".dockium", "reports");
  if (!fs.existsSync(reportsDir)) {
    return [];
  }

  const files = fs.readdirSync(reportsDir)
    .filter((name) => /^push-.*\.json$/i.test(name))
    .map((name) => path.join(reportsDir, name));

  const entries = [];
  for (const filePath of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      entries.push(toPushRecord({
        ...parsed,
        reportPath: filePath,
      }, parsed?.branch || "unknown"));
    } catch {}
  }

  return entries.sort((a, b) => {
    const aTs = new Date(a.timestamp || 0).getTime();
    const bTs = new Date(b.timestamp || 0).getTime();
    return bTs - aTs;
  });
}

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

  ipcMain.handle("gitgate:loadHistory", async (_event, payload = {}) => {
    const repoPath = payload.repoPath || getProjectPath();
    if (!repoPath) {
      return { ok: true, history: [] };
    }

    const history = loadHistoryReports(repoPath);
    return { ok: true, history };
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
    const branch = payload.branch || "unknown";

    try {
      getWss()?.emit("gitgate:start", {
        timestamp: new Date().toISOString(),
        branch,
      });

      const result = await gate.check("HEAD~1", {
        branch,
        persistReport: true,
        onLog: ({ message, level, step }) => {
          getWss()?.emit("gitgate:log", {
            timestamp: new Date().toISOString(),
            message: String(message || ""),
            level: String(level || "info"),
            step: String(step || ""),
          });
        },
      });

      const record = toPushRecord(result, branch);
      addPushHistory(record);
      getWss()?.emit("gitgate:result", record);
      getWss()?.emitLog(`Gate result: ${record.result}`);
      return { ok: true, result: { allowed: !record.result.includes("BLOCKED"), ...result } };
    } catch (error) {
      const detail = String(error?.message || "Gate check failed");
      getWss()?.emit("gitgate:log", {
        timestamp: new Date().toISOString(),
        message: detail,
        level: "error",
        step: "gate-check",
      });
      return { ok: false, error: detail };
    }
  });
}

module.exports = { registerGitIpc };
