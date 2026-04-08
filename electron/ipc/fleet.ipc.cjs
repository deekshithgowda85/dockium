const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function normalizeRequestedRoles(roles) {
  if (!Array.isArray(roles)) {
    return [];
  }
  return roles
    .map((role) => String(role || "").trim())
    .filter(Boolean);
}

function isMissingPlaywrightExecutable(error) {
  const text = String(error?.message || "").toLowerCase();
  return text.includes("executable doesn't exist")
    || text.includes("playwright install")
    || text.includes("please run the following command")
    || text.includes("download new browsers")
    || text.includes("browsertype.launch");
}

function cleanTerminalText(value) {
  const raw = String(value || "");
  const noAnsi = raw.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
  const noControl = noAnsi.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return noControl;
}

function runCommand(command, args, getWss) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk || "");
      output += text;
      const cleaned = cleanTerminalText(text)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of cleaned) {
        getWss()?.emitLog(line.slice(0, 240));
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk || "");
      output += text;
      const cleaned = cleanTerminalText(text)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of cleaned) {
        getWss()?.emitLog(line.slice(0, 240), "warn");
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(output.trim() || `${command} exited with code ${code}`));
    });
  });
}

function hasPlaywrightCache(engine) {
  const target = String(engine || "chromium").toLowerCase();
  const baseDir = process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "ms-playwright")
    : path.join(os.homedir(), ".cache", "ms-playwright");

  if (!fs.existsSync(baseDir)) {
    return false;
  }

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    return entries.some((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(`${target}-`));
  } catch {
    return false;
  }
}

function installPlaywrightBrowsers(browserEngine, getWss) {
  return new Promise((resolve, reject) => {
    const engine = String(browserEngine || "chromium").toLowerCase();
    const playwrightTarget = ["chromium", "firefox", "webkit"].includes(engine)
      ? engine
      : "chromium";

    if (hasPlaywrightCache(playwrightTarget)) {
      getWss()?.emitLog(`Playwright ${playwrightTarget} cache already present. Skipping install.`);
      resolve();
      return;
    }

    const nodeBin = process.execPath;
    let cliPath = "";
    const candidates = [];
    try {
      candidates.push(require.resolve("playwright/cli"));
    } catch {}
    candidates.push(path.join(process.cwd(), "node_modules", "playwright", "cli.js"));

    for (const candidate of candidates) {
      const normalized = path.extname(candidate) ? candidate : `${candidate}.js`;
      if (fs.existsSync(normalized)) {
        cliPath = normalized;
        break;
      }
    }

    const runLocalCli = async () => {
      if (!cliPath) {
        throw new Error("playwright cli not found in node_modules");
      }
      await runCommand(nodeBin, [cliPath, "install", playwrightTarget], getWss);
    };

    const runNpxFallback = async () => {
      const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
      await runCommand(npxCommand, ["playwright", "install", playwrightTarget], getWss);
    };

    const runNpxFullInstall = async () => {
      const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
      await runCommand(npxCommand, ["playwright", "install"], getWss);
    };

    (async () => {
      try {
        await runLocalCli();
        resolve();
      } catch (localError) {
        try {
          await runNpxFallback();
          resolve();
        } catch (npxError) {
          try {
            await runNpxFullInstall();
            resolve();
          } catch (fullError) {
            reject(
              new Error(
                `Playwright browser install failed. Local CLI error: ${localError.message}. npx target fallback error: ${npxError.message}. npx full fallback error: ${fullError.message}`,
              ),
            );
          }
        }
      }
    })();
  });
}

async function startFleetInstance(runtime, payload = {}) {
  if (!runtime.projectConfig) {
    return { ok: false, error: "No project loaded" };
  }

  const requestConfig = {
    browserEngine: payload.browserEngine || "chromium",
    headless: payload.headless === true,
    windowCount: Number(payload.windowCount || 6),
    roles: normalizeRequestedRoles(payload.roles),
    useProxy: payload.useProxy === true,
  };

  if (runtime.browserFleet) {
    await runtime.browserFleet.closeAll();
    runtime.browserFleet = null;
  }

  runtime.browserFleet = new runtime.BrowserFleet(runtime.projectConfig, runtime.wss);
  await runtime.browserFleet.initialize(runtime.appMap?.routeTree || [], requestConfig);

  const roles = runtime.browserFleet.resolveRoleNames(requestConfig);
  for (const role of roles) {
    await runtime.browserFleet.launchSession(role);
  }

  return {
    ok: true,
    roles,
    status: runtime.browserFleet.getStats(),
    config: requestConfig,
  };
}

async function ensureFleetRuntimeContainers(runtime) {
  if (!runtime?.projectConfig || !runtime?.ContainerManager) {
    return;
  }

  const configWithWs = { ...runtime.projectConfig, wss: runtime.wss };
  if (runtime.ContainerManager.ensureAppRunning) {
    await runtime.ContainerManager.ensureAppRunning(configWithWs);
  }
}

async function startFleetWithHeadlessFallback(runtime, payload, getWss) {
  const primaryPayload = {
    ...payload,
    headless: payload?.headless === true,
  };

  try {
    return await startFleetInstance(runtime, primaryPayload);
  } catch (error) {
    if (primaryPayload.headless === true) {
      throw error;
    }

    getWss()?.emitLog(
      "Headed browser launch failed. Retrying fleet in headless mode with live preview stream.",
      "warn",
    );
    return startFleetInstance(runtime, { ...primaryPayload, headless: true });
  }
}

function registerFleetIpc(ipcMain, deps) {
  const { runtime, getWss, ensureProxyEngine, getProxyEngine } = deps;

  ipcMain.handle("fleet:start", async (_event, payload = {}) => {
    try {
      if (payload?.useProxy === true) {
        const existingProxy = typeof getProxyEngine === "function" ? getProxyEngine() : null;
        const proxyEngine = existingProxy || (typeof ensureProxyEngine === "function" ? ensureProxyEngine({}) : null);
        if (proxyEngine?.start) {
          await proxyEngine.start();
          getWss()?.emitLog("Proxy auto-started for browser fleet run");
        }
      }

      await ensureFleetRuntimeContainers(runtime);

      let result;
      try {
        result = await startFleetWithHeadlessFallback(runtime, payload, getWss);
      } catch (error) {
        if (!isMissingPlaywrightExecutable(error)) {
          throw error;
        }

        const browserEngine = String(payload.browserEngine || "chromium").toLowerCase();
        getWss()?.emitLog(
          `Playwright browser binary missing for ${browserEngine}. Installing runtime browser package...`,
          "warn",
        );
        await installPlaywrightBrowsers(browserEngine, getWss);
        getWss()?.emitLog("Playwright browser install completed. Retrying fleet startup.");
        result = await startFleetWithHeadlessFallback(runtime, payload, getWss);
      }

      if (result.ok) {
        getWss()?.emitLog(`Browser fleet started (${result.roles.length} sessions)`);
      }
      return result;
    } catch (error) {
      const message = String(error?.message || "Failed to start browser fleet");
      getWss()?.emitLog(`Browser fleet start error: ${message}`, "error");
      const installHint =
        "If this is a first run, install browser binaries with: npx playwright install chromium";
      return { ok: false, error: `${message}. ${installHint}` };
    }
  });

  ipcMain.handle("fleet:stop", async () => {
    if (!runtime.browserFleet) {
      return { ok: true };
    }

    await runtime.browserFleet.closeAll();
    runtime.browserFleet = null;
    getWss()?.emitLog("Browser fleet stopped");
    return { ok: true };
  });

  ipcMain.handle("fleet:getStatus", async () => {
    if (!runtime.browserFleet) {
      return { ok: true, status: {} };
    }

    return { ok: true, status: runtime.browserFleet.getStats() };
  });
}

module.exports = { registerFleetIpc };
