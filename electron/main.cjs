const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");

const { registerDockerIpc } = require("./ipc/docker.ipc.cjs");
const { registerScanIpc } = require("./ipc/scan.ipc.cjs");
const { registerNucleiIpc } = require("./ipc/nuclei.ipc.cjs");
const { registerGitIpc } = require("./ipc/git.ipc.cjs");
const { registerProxyIpc } = require("./ipc/proxy.ipc.cjs");
const { registerProjectIpc } = require("./ipc/project.ipc.cjs");
const { registerReportIpc } = require("./ipc/report.ipc.cjs");
const { registerFleetIpc } = require("./ipc/fleet.ipc.cjs");

let mainWindow = null;
let splashWindow = null;
let persistentStore = null;

const runtime = {
  coreRuntimeReady: false,
  wss: null,
  FrameworkDetector: null,
  EnvDetector: null,
  generateDockerfile: null,
  ContainerManager: null,
  ScanOrchestrator: null,
  NucleiScanner: null,
  DiscoveryEngine: null,
  GitHookInstaller: null,
  GitGate: null,
  ProxyEngine: null,
  BrowserFleet: null,
  Ingestion: null,
  ReportBuilder: null,
  PdfExporter: null,
  MarkdownExporter: null,
  JsonExporter: null,
  projectPath: "",
  projectConfig: null,
  projectInfo: null,
  appMap: { folderTree: [], routeTree: [], apiGraph: [], authBoundaries: [] },
  lastScan: null,
  latestReport: null,
  pushHistory: [],
  gateRules: {
    blockCritical: true,
    blockHigh: true,
    blockSecrets: true,
    blockTestFailures: true,
  },
  proxyEngine: null,
  browserFleet: null,
};

const defaultSettings = {
  appTheme: "Dark",
  fontSize: "13px",
  logLevel: "info",
  autoOpenProxy: true,
  scanOnBoot: false,
  proxyPort: 8080,
  interceptByDefault: false,
  sslCertTrust: "Auto install",
  defaultScanMode: "Full",
  payloadIntensity: "Medium",
  timeoutPerRequest: 5000,
  gitBlockCritical: true,
  gitBlockHigh: true,
  gitBlockSecrets: true,
  maxScanDuration: "5 min",
  reportIncludeEvidence: true,
  reportDefaultFormat: "PDF",
  advancedTelemetry: false,
  advancedVerboseIpc: false,
};

const defaultOnboardingState = {
  projectLoaded: false,
  projectPath: "",
  importedImage: "",
  importedMode: false,
  detection: null,
  config: {
    portOverride: 3000,
    dbTypeOverride: "PostgreSQL",
    useDbContainer: false,
  },
};

const defaultRecentDockerImports = [];

async function initPersistentStore() {
  if (persistentStore) {
    return persistentStore;
  }

  const { default: Store } = await import("electron-store");
  persistentStore = new Store({
    name: "dockium",
    defaults: {
      settings: defaultSettings,
      onboarding: defaultOnboardingState,
      pushHistory: [],
      gateRules: runtime.gateRules,
      recentDockerImports: defaultRecentDockerImports,
    },
  });

  runtime.pushHistory = persistentStore.get("pushHistory") || [];
  runtime.gateRules = { ...runtime.gateRules, ...(persistentStore.get("gateRules") || {}) };

  return persistentStore;
}

function getStore() {
  if (!persistentStore) {
    throw new Error("Persistent store not initialized");
  }
  return persistentStore;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeVersion(version) {
  const asText = String(version ?? "unknown");
  const stripped = asText.replace(/^[^\d]*/, "");
  return stripped || asText;
}

async function normalizeProjectPath(inputPath) {
  const absolute = path.resolve(inputPath);
  try {
    const stats = await fs.stat(absolute);
    return stats.isDirectory() ? absolute : path.dirname(absolute);
  } catch {
    return absolute;
  }
}

async function detectProjectLocal(projectPath) {
  const normalizedPath = await normalizeProjectPath(projectPath);
  const packagePath = path.join(normalizedPath, "package.json");

  let framework = "Unknown";
  let version = "unknown";

  try {
    const packageRaw = await fs.readFile(packagePath, "utf8");
    const packageJson = JSON.parse(packageRaw);
    const dependencies = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };

    if (dependencies.next) {
      framework = "nextjs";
      version = normalizeVersion(dependencies.next);
    } else if (dependencies.react && dependencies.vite) {
      framework = "react-vite";
      version = normalizeVersion(dependencies.react);
    } else if (dependencies.express) {
      framework = "express";
      version = normalizeVersion(dependencies.express);
    }
  } catch {
    framework = "Unknown";
    version = "unknown";
  }

  const hasNodeModules = await exists(path.join(normalizedPath, "node_modules"));
  const hasEnvExample = await exists(path.join(normalizedPath, ".env.example"));
  const hasPrismaSchema = await exists(path.join(normalizedPath, "prisma", "schema.prisma"));
  const hasSrcApp = await exists(path.join(normalizedPath, "src", "app"));

  return {
    projectPath: normalizedPath,
    framework,
    version,
    hasNodeModules,
    hasEnvExample,
    schemaPath: hasPrismaSchema ? "prisma/schema.prisma" : "not found",
    routeMapSource: hasSrcApp ? "src/app/**" : "src/**",
  };
}

function coreModulePath(relativePath) {
  return pathToFileURL(path.join(__dirname, "core", relativePath)).href;
}

async function bootstrapCoreRuntime() {
  if (runtime.coreRuntimeReady) {
    return;
  }

  const [
    detectorMod,
    envMod,
    dockerGenMod,
    containerManagerMod,
    scanMod,
    nucleiScannerMod,
    discoveryMod,
    gitHookMod,
    gitGateMod,
    proxyMod,
    browserMod,
    wsMod,
    ingestionMod,
    reportBuilderMod,
    pdfExporterMod,
    markdownExporterMod,
    jsonExporterMod,
  ] = await Promise.all([
    import(coreModulePath("detector/FrameworkDetector.js")),
    import(coreModulePath("detector/EnvDetector.js")),
    import(coreModulePath("docker/generator.js")),
    import(coreModulePath("orchestrator/ContainerManager.js")),
    import(coreModulePath("scanner/ScanOrchestrator.js")),
    import(coreModulePath("scanner/modules/NucleiScanner.js")),
    import(coreModulePath("scanner/DiscoveryEngine.js")),
    import(coreModulePath("git/GitHookInstaller.js")),
    import(coreModulePath("git/GitGate.js")),
    import(coreModulePath("proxy/ProxyEngine.js")),
    import(coreModulePath("browser/BrowserFleet.js")),
    import(coreModulePath("realtime/WebSocketServer.js")),
    import(coreModulePath("ingestion/Ingestion.js")),
    import(coreModulePath("report/ReportBuilder.js")),
    import(coreModulePath("report/exporters/PdfExporter.js")),
    import(coreModulePath("report/exporters/MarkdownExporter.js")),
    import(coreModulePath("report/exporters/JsonExporter.js")),
  ]);

  runtime.FrameworkDetector = detectorMod.default;
  runtime.EnvDetector = envMod.default;
  runtime.generateDockerfile = dockerGenMod.generateDockerfile;
  runtime.ContainerManager = containerManagerMod.default;
  runtime.ScanOrchestrator = scanMod.default;
  runtime.NucleiScanner = nucleiScannerMod.default;
  runtime.DiscoveryEngine = discoveryMod.default;
  runtime.GitHookInstaller = gitHookMod.default;
  runtime.GitGate = gitGateMod.default;
  runtime.ProxyEngine = proxyMod.default;
  runtime.BrowserFleet = browserMod.default;
  runtime.Ingestion = ingestionMod.default;
  runtime.ReportBuilder = reportBuilderMod.default;
  runtime.PdfExporter = pdfExporterMod.default;
  runtime.MarkdownExporter = markdownExporterMod.default;
  runtime.JsonExporter = jsonExporterMod.default;

  const WebSocketServer = wsMod.default;
  runtime.wss = new WebSocketServer(4242);
  await runtime.wss.start();
  runtime.wss.emitLog("Dockium core runtime initialized");

  runtime.coreRuntimeReady = true;
}

function buildProjectConfig(repoPath, frameworkInfo, options = {}) {
  const appPort = Number(options.portOverride || frameworkInfo.appPort || 3000);
  const useDbContainer = options.useDbContainer === true;
  const dbTypeOverride = String(options.dbTypeOverride || "").toLowerCase();
  const dbType = dbTypeOverride.includes("mysql")
    ? "mysql"
    : dbTypeOverride.includes("sqlite")
      ? "sqlite"
      : (frameworkInfo.dbType || "postgres");

  return {
    project: {
      name: path.basename(repoPath),
      path: repoPath,
      framework: frameworkInfo.framework,
      version: frameworkInfo.version,
      language: frameworkInfo.language || "node",
      dbType,
      ormType: frameworkInfo.ormType || "none",
      appPort,
      dbPort: dbType === "mysql" ? 3306 : 5432,
      useDbContainer,
      targetUrl: `http://localhost:${appPort}`,
      testCommand: frameworkInfo.testCommand || "npm test",
    },
    credentials: {
      adminEmail: "admin@dockium.local",
      adminPassword: "Password123!",
      testUserEmail: "user@dockium.local",
      testUserPass: "Password123!",
    },
    modules: {
      browserFleet: true,
      browserUse: true,
      proxy: true,
      secrets: true,
      cve: true,
      infra: true,
      businessLogic: false,
      deepXss: false,
    },
    gitGate: {
      enabled: true,
      blockOn: ["critical", "high"],
      blockOnSecrets: true,
      blockOnTestFailure: true,
      allowOverride: false,
    },
  };
}

function buildImportedImageMap(imageRef) {
  const lower = String(imageRef || "").toLowerCase();
  const isJuiceShop = lower.includes("juice-shop");

  const routeTree = isJuiceShop
    ? [
        { method: "GET", path: "/", authRequired: false, sourceFile: "image://frontend" },
        { method: "GET", path: "/rest/products/search", authRequired: false, sourceFile: "image://api" },
        { method: "GET", path: "/api/Challenges", authRequired: false, sourceFile: "image://api" },
        { method: "POST", path: "/rest/user/login", authRequired: false, sourceFile: "image://api" },
        { method: "POST", path: "/rest/user/signup", authRequired: false, sourceFile: "image://api" },
        { method: "GET", path: "/rest/basket/:id", authRequired: true, sourceFile: "image://api" },
        { method: "POST", path: "/api/Feedbacks", authRequired: false, sourceFile: "image://api" },
        { method: "GET", path: "/rest/admin/application-version", authRequired: true, sourceFile: "image://api" },
      ]
    : [
        { method: "GET", path: "/", authRequired: false, sourceFile: "image://entrypoint" },
      ];

  const apiGraph = routeTree.map((route) => ({
    route: `${route.method} ${route.path}`,
    method: route.method,
    path: route.path,
    requestSchema: route.method === "GET" ? {} : { body: { type: "object" } },
    responseSchema: { status: { type: "number" }, data: { type: "object" } },
    callChain: [
      `${route.method} ${route.path}`,
      "container://web",
      "service://application",
      "response",
    ],
  }));

  const authBoundaries = routeTree.map((route) => ({
    path: route.path,
    requiredRole: route.authRequired ? (route.path.includes("/admin") ? "admin" : "user") : "none",
    enforcedBy: route.authRequired ? "token/session middleware" : "public",
  }));

  const folderTree = {
    name: imageRef,
    type: "directory",
    children: [
      {
        name: "container/",
        type: "directory",
        path: "container",
        annotation: null,
        children: [
          {
            name: "image-manifest.json",
            type: "file",
            path: "container/image-manifest.json",
            annotation: "CONFIG",
            children: [],
          },
          {
            name: "inferred-routes.json",
            type: "file",
            path: "container/inferred-routes.json",
            annotation: "ROUTE",
            children: [],
          },
        ],
      },
      {
        name: "runtime/",
        type: "directory",
        path: "runtime",
        annotation: null,
        children: [
          {
            name: "proxy-capture.log",
            type: "file",
            path: "runtime/proxy-capture.log",
            annotation: "UTIL",
            children: [],
          },
        ],
      },
    ],
  };

  return { folderTree, routeTree, apiGraph, authBoundaries };
}

async function hydrateImportedImageProject(imageRef, options = {}) {
  const normalized = String(imageRef || "").trim();
  if (!normalized) {
    throw new Error("Missing imported image reference");
  }

  await bootstrapCoreRuntime();

  const appPort = Number(options.portOverride || 3000);
  const useDbContainer = options.useDbContainer === true;
  const dbTypeOverride = String(options.dbTypeOverride || "").toLowerCase();
  const dbType = dbTypeOverride.includes("mysql")
    ? "mysql"
    : dbTypeOverride.includes("sqlite")
      ? "sqlite"
      : "postgres";

  runtime.projectConfig = {
    project: {
      name: normalized,
      path: `docker://${normalized}`,
      framework: "container-image",
      version: "latest",
      language: "container",
      dbType,
      ormType: "none",
      appPort,
      dbPort: dbType === "mysql" ? 3306 : 5432,
      useDbContainer,
      targetUrl: `http://localhost:${appPort}`,
      testCommand: "",
      importedImage: normalized,
    },
    credentials: {
      adminEmail: "admin@dockium.local",
      adminPassword: "Password123!",
      testUserEmail: "user@dockium.local",
      testUserPass: "Password123!",
    },
    modules: {
      browserFleet: true,
      browserUse: true,
      proxy: true,
      secrets: true,
      cve: true,
      infra: true,
      businessLogic: false,
      deepXss: false,
    },
    gitGate: {
      enabled: true,
      blockOn: ["critical", "high"],
      blockOnSecrets: true,
      blockOnTestFailure: true,
      allowOverride: false,
    },
  };

  runtime.projectPath = `docker://${normalized}`;
  runtime.appMap = buildImportedImageMap(normalized);
  runtime.projectInfo = {
    name: normalized,
    projectPath: runtime.projectPath,
    framework: "container-image",
    version: "latest",
    targetUrl: runtime.projectConfig.project.targetUrl,
    dbType,
    schemaPath: "container://schema-inferred",
    routeMapSource: "container image introspection",
    routeCount: runtime.appMap.routeTree.length,
    apiFlowCount: runtime.appMap.apiGraph.length,
  };

  runtime.wss?.emitLog(`Imported image project hydrated: ${normalized}`);

  return {
    projectInfo: runtime.projectInfo,
    appMap: runtime.appMap,
    config: runtime.projectConfig,
  };
}

async function openProject(projectPath, options = {}) {
  await bootstrapCoreRuntime();

  const normalizedPath = await normalizeProjectPath(projectPath);
  const frameworkDetector = new runtime.FrameworkDetector();
  const envDetector = new runtime.EnvDetector();

  let frameworkInfo;
  try {
    frameworkInfo = await frameworkDetector.detect(normalizedPath);
  } catch {
    const local = await detectProjectLocal(normalizedPath);
    frameworkInfo = {
      framework: local.framework === "Unknown" ? "express" : local.framework,
      version: local.version,
      language: "node",
      dbType: "postgres",
      ormType: "none",
      testCommand: "npm test",
    };
  }

  const config = buildProjectConfig(normalizedPath, frameworkInfo, options);
  const dockiumDir = path.join(normalizedPath, ".dockium");
  await fs.mkdir(dockiumDir, { recursive: true });

  const envString = await envDetector.generateEnv(normalizedPath, {
    ...frameworkInfo,
    appPort: config.project.appPort,
  });

  await fs.writeFile(path.join(dockiumDir, ".env"), envString, "utf8");
  await fs.writeFile(path.join(dockiumDir, "config.json"), JSON.stringify(config, null, 2), "utf8");

  await runtime.generateDockerfile(normalizedPath, {
    ...frameworkInfo,
    appPort: config.project.appPort,
  });

  let routeTree = [];
  let folderTree = { name: path.basename(normalizedPath), type: "directory", children: [] };
  let apiGraph = [];
  let authBoundaries = [];

  if (options.runIngestion) {
    const ingestion = new runtime.Ingestion(runtime.ContainerManager, runtime.wss);
    const ingested = await ingestion.ingest(normalizedPath, { ...config, wss: runtime.wss });
    routeTree = ingested.appMap.routeTree;
    folderTree = ingested.appMap.folderTree;
    apiGraph = Array.isArray(ingested.appMap.apiGraph) ? ingested.appMap.apiGraph : [];
    authBoundaries = Array.isArray(ingested.appMap.authBoundaries)
      ? ingested.appMap.authBoundaries
      : [];
  } else {
    const discovery = new runtime.DiscoveryEngine(config, normalizedPath);
    [routeTree, folderTree, apiGraph] = await Promise.all([
      discovery.discoverRoutes(),
      discovery.discoverFileTree(),
      discovery.discoverApiGraph([]),
    ]);
    authBoundaries = await discovery.discoverAuthBoundaries(routeTree, []);
  }

  runtime.projectPath = normalizedPath;
  runtime.projectConfig = config;
  runtime.appMap = {
    folderTree,
    routeTree,
    apiGraph,
    authBoundaries,
  };

  runtime.projectInfo = {
    name: config.project.name,
    projectPath: normalizedPath,
    framework: config.project.framework,
    version: config.project.version,
    targetUrl: config.project.targetUrl,
    dbType: config.project.dbType,
    schemaPath: "prisma/schema.prisma",
    routeMapSource: "src/**",
    routeCount: routeTree.length,
    apiFlowCount: apiGraph.length,
  };

  runtime.wss?.emitLog(`Detected: ${config.project.framework} ${config.project.version}`);
  runtime.wss?.emitLog(`Generated Dockerfile and env at ${dockiumDir}`);

  return {
    projectInfo: runtime.projectInfo,
    appMap: runtime.appMap,
    config,
  };
}

function defaultExportName(extension) {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `dockium-report-${stamp}.${extension}`;
}

function registerCoreIpcHandlers() {
  registerDockerIpc(ipcMain, {
    getProjectConfig: () => runtime.projectConfig,
    getContainerManager: () => runtime.ContainerManager,
    getWss: () => runtime.wss,
    getRecentImports: () => getStore().get("recentDockerImports") || [],
    setRecentImports: (next) => getStore().set("recentDockerImports", next),
  });

  registerScanIpc(ipcMain, {
    getProjectConfig: () => runtime.projectConfig,
    createScanOrchestrator: (config) => new runtime.ScanOrchestrator(config),
    ensureScanRuntime: async (config) => {
      if (runtime.ContainerManager?.ensureAppRunning) {
        await runtime.ContainerManager.ensureAppRunning({ ...config, wss: runtime.wss });
      }

      if (!runtime.ContainerManager?.ensureScannerRunning) {
        return;
      }
      await runtime.ContainerManager.ensureScannerRunning({ ...config, wss: runtime.wss });
    },
    buildReport: async (scanResult) => {
      const builder = new runtime.ReportBuilder();
      return await builder.build(scanResult, runtime.projectInfo, runtime.appMap, runtime.latestReport);
    },
    setLastScan: (scan) => {
      runtime.lastScan = scan;
    },
    setLatestReport: (report) => {
      runtime.latestReport = report;
    },
    getLastScan: () => runtime.lastScan,
    getWss: () => runtime.wss,
  });

  registerNucleiIpc(ipcMain, {
    getProjectConfig: () => runtime.projectConfig,
    createNucleiScanner: (config) => new runtime.NucleiScanner(config),
    ensureNucleiRuntime: async (config) => {
      if (runtime.ContainerManager?.ensureAppRunning) {
        await runtime.ContainerManager.ensureAppRunning({ ...config, wss: runtime.wss });
      }

      if (runtime.ContainerManager?.ensureScannerRunning) {
        await runtime.ContainerManager.ensureScannerRunning({ ...config, wss: runtime.wss });
      }
    },
    getWss: () => runtime.wss,
  });

  registerGitIpc(ipcMain, {
    getProjectPath: () => runtime.projectPath,
    createGitHookInstaller: () => new runtime.GitHookInstaller(),
    createGitGate: (repoPath) => new runtime.GitGate(runtime.projectConfig, repoPath),
    addPushHistory: (record) => {
      runtime.pushHistory = [record, ...runtime.pushHistory].slice(0, 200);
      getStore().set("pushHistory", runtime.pushHistory);
    },
    getPushHistory: () => runtime.pushHistory,
    getGateRules: () => runtime.gateRules,
    setGateRules: (rules) => {
      runtime.gateRules = { ...runtime.gateRules, ...rules };
      getStore().set("gateRules", runtime.gateRules);
    },
    getWss: () => runtime.wss,
  });

  registerProxyIpc(ipcMain, {
    ensureProxyEngine: (config) => {
      if (!runtime.proxyEngine) {
        runtime.proxyEngine = new runtime.ProxyEngine({
          ...config,
          project: runtime.projectConfig?.project,
          wss: runtime.wss,
        });
      }
      return runtime.proxyEngine;
    },
    getProxyEngine: () => runtime.proxyEngine,
    getWss: () => runtime.wss,
  });

  registerProjectIpc(ipcMain, {
    openProject,
    openImportedImage: hydrateImportedImageProject,
    getProjectInfo: () => runtime.projectInfo,
    getAppMap: () => runtime.appMap,
  });

  registerFleetIpc(ipcMain, {
    runtime,
    getWss: () => runtime.wss,
  });

  registerReportIpc(ipcMain, BrowserWindow, dialog, {
    getLatestReport: () => runtime.latestReport,
    exporters: {
      pdf: runtime.PdfExporter,
      markdown: runtime.MarkdownExporter,
      json: runtime.JsonExporter,
    },
  });

  ipcMain.handle("report:export", async (event, payload = {}) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!senderWindow) {
      return { ok: false, error: "No active window for export" };
    }

    const format = payload.format;
    if (!["pdf", "markdown", "json"].includes(format)) {
      return { ok: false, error: "Unsupported export format" };
    }

    try {
      if (format === "pdf") {
        const save = await dialog.showSaveDialog(senderWindow, {
          title: "Export Security Report (PDF)",
          defaultPath: defaultExportName("pdf"),
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });

        if (save.canceled || !save.filePath) {
          return { ok: false, canceled: true };
        }

        const pdfBuffer = await senderWindow.webContents.printToPDF({
          printBackground: true,
          pageSize: "A4",
        });

        await fs.writeFile(save.filePath, pdfBuffer);
        return { ok: true, filePath: save.filePath };
      }

      const extension = format === "markdown" ? "md" : "json";
      const save = await dialog.showSaveDialog(senderWindow, {
        title: `Export Security Report (${format.toUpperCase()})`,
        defaultPath: defaultExportName(extension),
        filters: [{ name: format.toUpperCase(), extensions: [extension] }],
      });

      if (save.canceled || !save.filePath) {
        return { ok: false, canceled: true };
      }

      await fs.writeFile(save.filePath, payload.content ?? "", "utf8");
      return { ok: true, filePath: save.filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("settings:get-all", async () => {
    const store = getStore();
    return store.get("settings");
  });

  ipcMain.handle("settings:update", async (_event, payload = {}) => {
    const { key, value } = payload;
    if (!key) {
      return { ok: false, error: "Missing setting key" };
    }

    const store = getStore();
    store.set(`settings.${key}`, value);
    return { ok: true, settings: store.get("settings") };
  });

  ipcMain.handle("onboarding:get-state", async () => {
    const store = getStore();
    return store.get("onboarding");
  });

  ipcMain.handle("onboarding:set-state", async (_event, payload = {}) => {
    const store = getStore();
    const current = store.get("onboarding");
    const { ...statePayload } = payload;
    const next = {
      ...current,
      ...statePayload,
      config: {
        ...(current.config ?? {}),
        ...(statePayload.config ?? {}),
      },
    };

    if (statePayload.projectLoaded) {
      try {
        const importedMode = Boolean(statePayload.importedMode)
          || String(statePayload.projectPath || "").startsWith("docker://")
          || Boolean(statePayload.importedImage);

        if (importedMode && statePayload.importedImage) {
          await hydrateImportedImageProject(statePayload.importedImage, statePayload.config || {});
        } else if (statePayload.projectPath) {
          await openProject(statePayload.projectPath, statePayload.config || {});
        }
      } catch (error) {
        runtime.wss?.emitLog(`Project load warning: ${error.message}`, "warn");
      }
    }

    store.set("onboarding", next);
    return next;
  });

  ipcMain.handle("onboarding:detect-project", async (_event, payload = {}) => {
    const projectPath = payload.projectPath;
    if (!projectPath) {
      return { ok: false, error: "Missing project path" };
    }

    const detection = await detectProjectLocal(projectPath);
    return {
      ok: true,
      projectPath: detection.projectPath,
      detection,
    };
  });

  ipcMain.handle("onboarding:browse-project", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!senderWindow) {
      return { ok: false, error: "No active window" };
    }

    const selection = await dialog.showOpenDialog(senderWindow, {
      title: "Select Project Folder",
      properties: ["openDirectory"],
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const projectPath = selection.filePaths[0];
    const detection = await detectProjectLocal(projectPath);
    return {
      ok: true,
      projectPath: detection.projectPath,
      detection,
    };
  });

  ipcMain.handle("window:minimize", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!senderWindow) {
      return { ok: false, error: "No active window" };
    }

    senderWindow.minimize();
    return { ok: true };
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!senderWindow) {
      return { ok: false, error: "No active window" };
    }

    if (senderWindow.isMaximized()) {
      senderWindow.unmaximize();
      return { ok: true, isMaximized: false };
    }

    senderWindow.maximize();
    return { ok: true, isMaximized: true };
  });

  ipcMain.handle("window:is-maximized", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!senderWindow) {
      return { ok: false, error: "No active window", isMaximized: false };
    }

    return { ok: true, isMaximized: senderWindow.isMaximized() };
  });

  ipcMain.handle("window:close", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!senderWindow) {
      return { ok: false, error: "No active window" };
    }

    senderWindow.close();
    return { ok: true };
  });

  ipcMain.handle("window:openExternal", async (_event, payload = {}) => {
    const raw = String(payload?.url || "").trim();
    if (!raw) {
      return { ok: false, error: "Missing URL" };
    }

    try {
      const parsed = new URL(raw);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return { ok: false, error: "Only http/https URLs are allowed" };
      }

      await shell.openExternal(parsed.toString());
      return { ok: true };
    } catch {
      return { ok: false, error: "Invalid URL" };
    }
  });
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 320,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#1a1a1a",
    autoHideMenuBar: true,
  });

  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
    }
  });
}

function hideSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    minimizable: true,
    maximizable: true,
    closable: true,
    show: false,
    backgroundColor: "#1a1a1a",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  const loadRenderer = async () => {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (!devServerUrl) {
      await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
      return;
    }

    const candidates = [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5174",
      devServerUrl,
    ].filter((value, index, array) => value && array.indexOf(value) === index);

    for (const candidate of candidates) {
      try {
        await mainWindow.loadURL(candidate);
        return;
      } catch {
        // Try next candidate.
      }
    }

    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  };

  loadRenderer().catch((error) => {
    console.error("[Dockium] Failed to load renderer:", error);
  });

  mainWindow.once("ready-to-show", () => {
    hideSplash();
    mainWindow.show();
    mainWindow.webContents.send("window:maximize-changed", {
      isMaximized: mainWindow.isMaximized(),
    });
  });

  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:maximize-changed", { isMaximized: true });
  });

  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:maximize-changed", { isMaximized: false });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function cleanupServices() {
  try {
    if (runtime.browserFleet) {
      await runtime.browserFleet.closeAll();
      runtime.browserFleet = null;
    }
  } catch {}

  try {
    if (runtime.proxyEngine) {
      await runtime.proxyEngine.stop();
      runtime.proxyEngine = null;
    }
  } catch {}

  try {
    if (runtime.ContainerManager) {
      await runtime.ContainerManager.stopAll();
    }
  } catch {}

  try {
    if (runtime.wss) {
      await runtime.wss.stop();
      runtime.wss = null;
    }
  } catch {}
}

function setupAppMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "New Project Setup",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("menu:navigate", { path: "/new-project" });
            }
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    { role: "help", submenu: [] },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("[Dockium] Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Dockium] Uncaught exception:", error);
});

app.whenReady()
  .then(async () => {
    await initPersistentStore();
    await bootstrapCoreRuntime();
    registerCoreIpcHandlers();
    setupAppMenu();

    createSplashWindow();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createSplashWindow();
        createWindow();
      }
    });
  })
  .catch((error) => {
    console.error("[Dockium] Startup failed:", error);
    app.quit();
  });

app.on("before-quit", async () => {
  await cleanupServices();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
