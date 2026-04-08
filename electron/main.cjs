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
let projectRestoreInFlight = null;

const runtime = {
  coreRuntimeReady: false,
  wss: null,
  FrameworkDetector: null,
  EnvDetector: null,
  generateDockerfile: null,
  ContainerManager: null,
  ScanOrchestrator: null,
  ArtemisScanner: null,
  DiscoveryEngine: null,
  FolderTreeBuilder: null,
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
  nucleiState: {
    status: null,
    findings: [],
  },
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
  reportLlmEnabled: false,
  reportLlmEndpoint: "https://api.groq.com/openai/v1/chat/completions",
  reportLlmModel: "llama-3.1-8b-instant",
  reportLlmApiKey: "",
  advancedTelemetry: false,
  advancedVerboseIpc: false,
};

const defaultOnboardingState = {
  projectLoaded: false,
  projectPath: "",
  importedImage: "",
  sourceRepoPath: "",
  importedMode: false,
  detection: null,
  config: {
    portOverride: 3000,
    dbTypeOverride: "PostgreSQL",
    useDbContainer: false,
    sourceRepoPath: "",
    adminEmail: "",
    adminPassword: "",
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
    artemisScannerMod,
    discoveryMod,
    folderTreeBuilderMod,
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
    import(coreModulePath("scanner/modules/ArtemisScanner.js")),
    import(coreModulePath("scanner/DiscoveryEngine.js")),
    import(coreModulePath("mapper/FolderTreeBuilder.js")),
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
  runtime.ArtemisScanner = artemisScannerMod.default;
  runtime.DiscoveryEngine = discoveryMod.default;
  runtime.FolderTreeBuilder = folderTreeBuilderMod.default;
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
      adminEmail: String(options.adminEmail || "admin@dockium.local"),
      adminPassword: String(options.adminPassword || "Password123!"),
      testUserEmail: String(options.testUserEmail || "user@dockium.local"),
      testUserPass: String(options.testUserPass || "Password123!"),
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

async function resolveFetch() {
  if (typeof fetch === "function") {
    return fetch;
  }
  const mod = await import("node-fetch");
  return mod.default;
}

function buildAuthHeadersFromToken(tokenValue = "") {
  const token = String(tokenValue || "").trim();
  if (!token) {
    return {};
  }
  if (/^bearer\s+/i.test(token)) {
    return { Authorization: token };
  }
  if (token.includes("=") && token.includes(";")) {
    return { Cookie: token };
  }
  if (token.includes("=") && !token.includes(" ")) {
    const [key, ...rest] = token.split("=");
    return { [key.trim()]: rest.join("=").trim() };
  }
  return { Authorization: `Bearer ${token}` };
}

function safeJsonParse(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error };
  }
}

function extractTokenFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const directCandidates = [
    payload.token,
    payload.access_token,
    payload.accessToken,
    payload.jwt,
    payload.id_token,
    payload.idToken,
    payload.authToken,
  ];

  for (const candidate of directCandidates) {
    const value = String(candidate || "").trim();
    if (value) {
      return value;
    }
  }

  const nestedCandidates = [
    payload.data,
    payload.result,
    payload.user,
    payload.authentication,
  ];

  for (const entry of nestedCandidates) {
    const nested = extractTokenFromPayload(entry);
    if (nested) {
      return nested;
    }
  }

  return "";
}

function getSetCookieValues(response) {
  try {
    if (typeof response?.headers?.getSetCookie === "function") {
      const values = response.headers.getSetCookie();
      return Array.isArray(values) ? values : [];
    }

    if (typeof response?.headers?.raw === "function") {
      const rawHeaders = response.headers.raw();
      const values = rawHeaders?.["set-cookie"];
      return Array.isArray(values) ? values : [];
    }

    const single = response?.headers?.get?.("set-cookie");
    return single ? [single] : [];
  } catch {
    return [];
  }
}

function toCookieHeader(cookies = []) {
  return cookies
    .map((cookie) => String(cookie || "").split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function normalizeOpenApiRoutes(spec) {
  const routes = [];
  if (!spec || typeof spec !== "object") {
    return routes;
  }

  const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
  Object.entries(spec.paths || {}).forEach(([rawPath, operations]) => {
    Object.entries(operations || {}).forEach(([method, operation]) => {
      if (!methods.has(String(method || "").toLowerCase())) {
        return;
      }

      const permissions = Array.isArray(operation?.security)
        ? operation.security.flatMap((entry) => Object.keys(entry || {}))
        : [];

      routes.push({
        method: String(method || "get").toUpperCase(),
        path: String(rawPath || "/").replace(/\{([^}]+)\}/g, ":$1"),
        authRequired: permissions.length > 0,
        authStatus: permissions.length > 0 ? "AUTH REQUIRED" : "PUBLIC",
        sourceFile: "image://openapi",
        sourceLine: 1,
        handlerName: String(operation?.operationId || operation?.summary || "openapi-handler"),
        middlewareChain: [],
        request: {
          pathParams: [],
          queryParams: [],
          bodySchema: operation?.requestBody?.content?.["application/json"]?.schema || null,
        },
        response: {
          statusCodes: Object.keys(operation?.responses || {}).map((code) => ({ code })),
          bodySchema: operation?.responses || {},
          contentType: "application/json",
        },
        permissions,
        roles: [],
        rateLimit: null,
        openApi: {
          summary: operation?.summary || "",
          tags: operation?.tags || [],
          operationId: operation?.operationId || "",
        },
      });
    });
  });

  return routes;
}

function buildApiGraphFromRoutes(routes = []) {
  return routes.map((route, index) => ({
    id: route?.id || `image-flow-${index + 1}`,
    route: `${route.method} ${route.path}`,
    method: route.method,
    path: route.path,
    requestSchema: route?.request?.bodySchema || {},
    responseSchema: route?.response?.bodySchema || {},
    callChain: [
      `${route.method} ${route.path}`,
      "container://app",
      route?.authRequired ? "auth://required" : "auth://public",
      "response",
    ],
  }));
}

function buildAuthBoundariesFromRoutes(routes = []) {
  return routes.map((route) => ({
    path: route.path,
    requiredRole: route.authRequired ? "user" : "none",
    requiredPermissions: Array.isArray(route.permissions) ? route.permissions : [],
    enforcedBy: route.authRequired ? "token/session middleware" : "public",
    authStatus: route.authStatus || (route.authRequired ? "AUTH REQUIRED" : "PUBLIC"),
  }));
}

async function fetchImportedOpenApiRoutes(targetUrl, authToken = "") {
  const base = String(targetUrl || "").trim().replace(/\/$/, "");
  if (!base) {
    return {
      routes: [],
      warnings: ["OpenAPI unavailable: target URL is missing."],
      summary: "OpenAPI unavailable for imported image target.",
      diagnostics: [
        {
          endpoint: "(none)",
          status: 0,
          kind: "config",
          message: "Missing target URL for imported-image OpenAPI fetch.",
          contentType: "",
          snippet: "",
        },
      ],
    };
  }

  const warnings = [];
  const diagnostics = [];
  const endpoints = [
    "/openapi.json",
    "/swagger.json",
    "/v3/api-docs",
    "/api-docs/swagger.json",
  ];

  const fetchImpl = await resolveFetch();
  const authHeaders = buildAuthHeadersFromToken(authToken);

  for (const endpoint of endpoints) {
    const url = `${base}${endpoint}`;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...authHeaders,
        },
      });

      const status = Number(response?.status || 0);
      const contentType = String(response?.headers?.get?.("content-type") || "");

      if (!response.ok) {
        diagnostics.push({
          endpoint,
          status,
          kind: "http",
          message: `HTTP ${status}`,
          contentType,
          snippet: "",
        });
        continue;
      }

      const text = await response.text();
      const snippet = String(text || "").trim().slice(0, 160);
      const looksLikeJson = /json/i.test(contentType)
        || /^\s*\{/.test(text)
        || /^\s*\[/.test(text);

      if (!looksLikeJson) {
        diagnostics.push({
          endpoint,
          status,
          kind: "non-json",
          message: `Expected JSON but received ${contentType || "unknown"}`,
          contentType,
          snippet,
        });
        continue;
      }

      const parsed = safeJsonParse(text);
      if (!parsed.ok) {
        diagnostics.push({
          endpoint,
          status,
          kind: "parse",
          message: String(parsed.error?.message || "JSON parse failed"),
          contentType,
          snippet,
        });
        continue;
      }

      const json = parsed.value;
      const routes = normalizeOpenApiRoutes(json);
      if (routes.length > 0) {
        const successSummary = `OpenAPI loaded from ${endpoint}.`;
        return { routes, warnings, summary: successSummary, diagnostics };
      }

      diagnostics.push({
        endpoint,
        status,
        kind: "empty",
        message: "JSON parsed but no OpenAPI paths were discovered.",
        contentType,
        snippet,
      });
    } catch (error) {
      diagnostics.push({
        endpoint,
        status: 0,
        kind: "network",
        message: String(error?.message || "Unknown network error"),
        contentType: "",
        snippet: "",
      });
    }
  }

  warnings.push("OpenAPI spec not found on imported image target. Expand debug for endpoint details.");
  return {
    routes: [],
    warnings,
    summary: "OpenAPI spec was not detected on imported image target.",
    diagnostics,
  };
}

function mergeImportedRoutes(baseRoutes = [], discoveredRoutes = []) {
  const map = new Map();
  [...baseRoutes, ...discoveredRoutes].forEach((route, index) => {
    const method = String(route?.method || "GET").toUpperCase();
    const pathValue = String(route?.path || "/");
    const key = `${method} ${pathValue}`;
    const previous = map.get(key);
    if (!previous) {
      map.set(key, {
        id: route?.id || `route-${index + 1}`,
        method,
        path: pathValue,
        fullPath: pathValue,
        authRequired: Boolean(route?.authRequired),
        authStatus: route?.authStatus || (route?.authRequired ? "AUTH REQUIRED" : "PUBLIC"),
        sourceFile: route?.sourceFile || "image://api",
        sourceLine: Number(route?.sourceLine || 1),
        handlerName: route?.handlerName || "anonymous-handler",
        middlewareChain: Array.isArray(route?.middlewareChain) ? route.middlewareChain : [],
        request: route?.request || { pathParams: [], queryParams: [], bodySchema: {} },
        response: route?.response || { statusCodes: [{ code: 200 }], bodySchema: {}, contentType: "application/json" },
        roles: Array.isArray(route?.roles) ? route.roles : [],
        permissions: Array.isArray(route?.permissions) ? route.permissions : [],
        rateLimit: route?.rateLimit || null,
        openApi: route?.openApi || null,
      });
      return;
    }

    previous.authRequired = previous.authRequired || Boolean(route?.authRequired);
    previous.authStatus = previous.authRequired ? "AUTH REQUIRED" : "PUBLIC";
    previous.permissions = [...new Set([...(previous.permissions || []), ...((route?.permissions) || [])])];
    previous.openApi = route?.openApi || previous.openApi;
    previous.request = route?.request?.bodySchema ? route.request : previous.request;
    previous.response = route?.response?.bodySchema ? route.response : previous.response;
    map.set(key, previous);
  });

  return [...map.values()].sort((a, b) => {
    const pathCmp = String(a.path).localeCompare(String(b.path));
    if (pathCmp !== 0) {
      return pathCmp;
    }
    return String(a.method).localeCompare(String(b.method));
  });
}

function buildLoginPayloadCandidates(credentials = {}) {
  const email = String(credentials?.adminEmail || credentials?.testUserEmail || "").trim();
  const password = String(credentials?.adminPassword || credentials?.testUserPass || "").trim();
  if (!email || !password) {
    return [];
  }

  return [
    { email, password },
    { username: email, password },
    { user: email, password },
    { identifier: email, password },
    { login: email, password },
    { credentials: { email, password } },
  ];
}

function isLikelyLoginRoute(route) {
  const method = String(route?.method || "GET").toUpperCase();
  const routePath = String(route?.path || "").toLowerCase();
  if (method !== "POST") {
    return false;
  }

  return /(login|signin|auth|session|token)/i.test(routePath);
}

async function attemptAutoLoginForImportedRoutes(routes = [], targetUrl = "", credentials = {}) {
  const base = String(targetUrl || "").trim().replace(/\/$/, "");
  if (!base) {
    return {
      ok: false,
      token: "",
      source: "none",
      endpoint: "",
      message: "Missing target URL for automatic authentication.",
    };
  }

  const candidates = routes.filter((route) => isLikelyLoginRoute(route));
  const payloads = buildLoginPayloadCandidates(credentials);
  if (!candidates.length || !payloads.length) {
    return {
      ok: false,
      token: "",
      source: "none",
      endpoint: "",
      message: "No login endpoint or credentials available for automatic authentication.",
    };
  }

  const fetchImpl = await resolveFetch();
  for (const route of candidates) {
    const loginPath = String(route?.path || "/").replace(/:([A-Za-z0-9_]+)/g, "1");
    const loginUrl = `${base}${loginPath.startsWith("/") ? loginPath : `/${loginPath}`}`;

    for (const body of payloads) {
      try {
        const response = await fetchImpl(loginUrl, {
          method: "POST",
          headers: {
            Accept: "application/json, text/plain;q=0.8, */*;q=0.5",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        const status = Number(response?.status || 0);
        const text = await response.text();
        const parsed = safeJsonParse(text);
        const fromBody = parsed.ok ? extractTokenFromPayload(parsed.value) : "";
        if (fromBody) {
          return {
            ok: true,
            token: fromBody,
            source: "auto-login-token",
            endpoint: loginPath,
            message: `Token obtained from ${loginPath} (HTTP ${status}).`,
          };
        }

        const cookieHeader = toCookieHeader(getSetCookieValues(response));
        if (cookieHeader) {
          return {
            ok: true,
            token: cookieHeader,
            source: "auto-login-cookie",
            endpoint: loginPath,
            message: `Session cookie obtained from ${loginPath} (HTTP ${status}).`,
          };
        }
      } catch {
        // Try next payload/route candidate.
      }
    }
  }

  return {
    ok: false,
    token: "",
    source: "none",
    endpoint: "",
    message: "Automatic login failed for discovered auth endpoints.",
  };
}

async function probeImportedRoutesWithAuth(routes = [], targetUrl = "", tokenValue = "") {
  const token = String(tokenValue || "").trim();
  if (!token) {
    return routes.map((route) => ({
      ...route,
      authStatus: route.authRequired ? "AUTH REQUIRED" : "PUBLIC",
      authLive: false,
      authFailed: false,
    }));
  }

  const base = String(targetUrl || "").trim().replace(/\/$/, "");
  if (!base) {
    return routes;
  }

  const fetchImpl = await resolveFetch();
  const authHeaders = buildAuthHeadersFromToken(token);

  const tested = await Promise.all(routes.map(async (route) => {
    if (!route?.authRequired) {
      return {
        ...route,
        authStatus: "PUBLIC",
        authLive: false,
        authFailed: false,
      };
    }

    const method = String(route?.method || "GET").toUpperCase();
    const rawPath = String(route?.path || "/").replace(/:([A-Za-z0-9_]+)/g, "1");
    const url = `${base}${rawPath.startsWith("/") ? rawPath : `/${rawPath}`}`;

    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          Accept: "application/json, text/plain;q=0.8, */*;q=0.5",
          ...authHeaders,
        },
      });

      const text = await response.text();
      const failed = response.status === 401 || response.status === 403;
      return {
        ...route,
        authStatus: failed ? "AUTH FAILED" : "AUTHED + LIVE DATA",
        authLive: !failed,
        authFailed: failed,
        liveRequest: {
          url,
          method,
          headers: authHeaders,
          body: null,
        },
        liveResponse: {
          statusCode: response.status,
          contentType: response.headers.get("content-type") || "unknown",
          bodyPreview: String(text || "").slice(0, 3000),
        },
      };
    } catch (error) {
      return {
        ...route,
        authStatus: "AUTH FAILED",
        authLive: false,
        authFailed: true,
        liveRequest: {
          url,
          method,
          headers: authHeaders,
          body: null,
        },
        liveResponse: {
          statusCode: 0,
          contentType: "unknown",
          bodyPreview: String(error?.message || "Request failed"),
        },
      };
    }
  }));

  return tested;
}

async function buildLinkedSourceTree(sourceRepoPath, routes = []) {
  const rawPath = String(sourceRepoPath || "").trim();
  if (!rawPath) {
    return null;
  }

  try {
    const normalizedPath = await normalizeProjectPath(rawPath);
    const stats = await fs.stat(normalizedPath);
    if (!stats.isDirectory()) {
      return null;
    }

    const builder = runtime.FolderTreeBuilder ? new runtime.FolderTreeBuilder() : null;
    if (!builder || typeof builder.build !== "function") {
      return null;
    }

    const built = await builder.build(normalizedPath, { routes });
    return {
      folderTree: built || null,
      packageGroups: Array.isArray(built?.packageGroups) ? built.packageGroups : [],
      sourceRepoPath: normalizedPath,
    };
  } catch {
    return null;
  }
}

async function enrichImportedImageMap(baseMap, targetUrl, authToken = "", options = {}) {
  const openApi = await fetchImportedOpenApiRoutes(targetUrl, authToken);
  const mergedRouteTree = mergeImportedRoutes(baseMap?.routeTree || [], openApi.routes || []);
  const providedToken = String(authToken || "").trim();

  let resolvedToken = providedToken;
  let authInfo = {
    mode: providedToken ? "manual-token" : "none",
    source: providedToken ? "manual" : "none",
    success: Boolean(providedToken),
    endpoint: "",
    message: providedToken
      ? "Manual authentication token applied."
      : "No authentication token provided.",
  };

  if (!resolvedToken && options?.autoAuth) {
    const autoResult = await attemptAutoLoginForImportedRoutes(
      mergedRouteTree,
      targetUrl,
      options?.credentials || {}
    );
    if (autoResult.ok) {
      resolvedToken = autoResult.token;
      authInfo = {
        mode: "auto-login",
        source: autoResult.source,
        success: true,
        endpoint: autoResult.endpoint,
        message: autoResult.message,
      };
    } else {
      authInfo = {
        mode: "auto-login",
        source: "none",
        success: false,
        endpoint: "",
        message: autoResult.message,
      };
    }
  }

  const authAwareRoutes = await probeImportedRoutesWithAuth(mergedRouteTree, targetUrl, resolvedToken);
  const linkedSource = await buildLinkedSourceTree(options?.sourceRepoPath, authAwareRoutes);
  const sourceMode = linkedSource?.folderTree ? "image-linked-source" : "image";
  const warnings = [
    ...(Array.isArray(baseMap?.warnings) ? baseMap.warnings : []),
    ...(Array.isArray(openApi.warnings) ? openApi.warnings : []),
  ];
  if (sourceMode === "image") {
    warnings.unshift("Imported image mode: source folder not linked. Attach source to view real project files.");
  }

  return {
    ...baseMap,
    sourceMode,
    folderTree: linkedSource?.folderTree || baseMap?.folderTree,
    routeTree: authAwareRoutes,
    apiGraph: buildApiGraphFromRoutes(authAwareRoutes),
    authBoundaries: buildAuthBoundariesFromRoutes(authAwareRoutes),
    packageGroups: linkedSource?.packageGroups || (baseMap?.packageGroups || []),
    warnings,
    openApiSummary: String(openApi.summary || ""),
    openApiDiagnostics: Array.isArray(openApi.diagnostics) ? openApi.diagnostics : [],
    authInfo,
    linkedSourcePath: linkedSource?.sourceRepoPath || "",
    scannedAt: new Date().toISOString(),
  };
}

async function testImportedRoute(route, options = {}) {
  const targetUrl = String(options?.targetUrl || "").trim().replace(/\/$/, "");
  if (!targetUrl) {
    return {
      ok: false,
      error: "Missing target URL for imported image route test",
      code: 400,
      detail: "targetUrl is required",
    };
  }

  const method = String(options?.method || route?.method || "GET").toUpperCase();
  const rawPath = String(route?.path || "/");
  const pathParams = Array.isArray(options?.pathParams)
    ? options.pathParams
    : (Array.isArray(options?.params) ? options.params : []);
  const queryParams = Array.isArray(options?.queryParams) ? options.queryParams : [];
  let materializedPath = rawPath.replace(/:([A-Za-z0-9_]+)/g, (_all, key) => {
    const matched = pathParams.find((entry) => String(entry?.name || "") === String(key));
    return encodeURIComponent(String(matched?.value || matched?.sample || 1));
  });
  if (!materializedPath.startsWith("/")) {
    materializedPath = `/${materializedPath}`;
  }
  const query = new URLSearchParams();
  queryParams.forEach((entry, index) => {
    const name = String(entry?.name || `q${index + 1}`).trim();
    if (!name) {
      return;
    }
    query.append(name, String(entry?.value || entry?.sample || "sample"));
  });
  const querySuffix = query.toString() ? `?${query.toString()}` : "";
  const url = `${targetUrl}${materializedPath}${querySuffix}`;
  const body = options?.body;
  const authHeaders = options?.authHeaders && typeof options.authHeaders === "object"
    ? options.authHeaders
    : {};
  const headers = {
    Accept: "application/json, text/plain;q=0.8, */*;q=0.5",
    ...(options?.headers || {}),
    ...authHeaders,
  };

  const fetchImpl = await resolveFetch();
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: ["POST", "PUT", "PATCH"].includes(method) ? JSON.stringify(body || {}) : undefined,
    });

    const text = await response.text();
    return {
      ok: true,
      route: {
        ...route,
        authStatus: response.status === 401 || response.status === 403 ? "AUTH FAILED" : "AUTHED + LIVE DATA",
        liveRequest: {
          url,
          method,
          pathParams,
          queryParams,
          headers,
          body: body || null,
        },
        liveResponse: {
          statusCode: response.status,
          contentType: response.headers.get("content-type") || "unknown",
          headers: Object.fromEntries(response.headers.entries()),
          bodyPreview: String(text || "").slice(0, 3000),
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || "Imported route test failed"),
      code: 500,
      detail: "request execution failed",
    };
  }
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

  return {
    sourceMode: "image",
    folderTree,
    routeTree,
    apiGraph,
    authBoundaries,
    packageGroups: [],
    warnings: ["Imported image mode: full source tree is unavailable unless a repository is mounted."],
    openApiSummary: "",
    openApiDiagnostics: [],
    authInfo: {
      mode: "none",
      source: "none",
      success: false,
      endpoint: "",
      message: "No authentication token provided.",
    },
    linkedSourcePath: "",
    scannedAt: new Date().toISOString(),
  };
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
  const sourceRepoPath = String(options.sourceRepoPath || "").trim();
  const adminEmail = String(options.adminEmail || "admin@dockium.local");
  const adminPassword = String(options.adminPassword || "Password123!");
  const testUserEmail = String(options.testUserEmail || "user@dockium.local");
  const testUserPass = String(options.testUserPass || "Password123!");

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
      sourceRepoPath,
    },
    credentials: {
      adminEmail,
      adminPassword,
      testUserEmail,
      testUserPass,
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
  const baseImportedMap = buildImportedImageMap(normalized);
  runtime.appMap = await enrichImportedImageMap(
    baseImportedMap,
    runtime.projectConfig.project.targetUrl,
    "",
    {
      sourceRepoPath,
      autoAuth: true,
      credentials: runtime.projectConfig.credentials,
    }
  );
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
    linkedSourcePath: runtime.appMap.linkedSourcePath || sourceRepoPath,
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
  let appMapWarnings = [];
  let packageGroups = [];
  let openApiInfo = { title: "", version: "" };
  let openApiSummary = "";
  let openApiDiagnostics = [];
  let authInfo = null;

  if (options.runIngestion) {
    const ingestion = new runtime.Ingestion(runtime.ContainerManager, runtime.wss);
    const ingested = await ingestion.ingest(normalizedPath, { ...config, wss: runtime.wss });
    routeTree = ingested.appMap.routeTree;
    folderTree = ingested.appMap.folderTree;
    apiGraph = Array.isArray(ingested.appMap.apiGraph) ? ingested.appMap.apiGraph : [];
    authBoundaries = Array.isArray(ingested.appMap.authBoundaries)
      ? ingested.appMap.authBoundaries
      : [];
    appMapWarnings = Array.isArray(ingested.appMap.warnings) ? ingested.appMap.warnings : [];
    packageGroups = Array.isArray(ingested.appMap.packageGroups) ? ingested.appMap.packageGroups : [];
    openApiInfo = ingested.appMap.openApiInfo || openApiInfo;
    openApiSummary = String(ingested.appMap.openApiSummary || "");
    openApiDiagnostics = Array.isArray(ingested.appMap.openApiDiagnostics)
      ? ingested.appMap.openApiDiagnostics
      : [];
    authInfo = ingested.appMap.authInfo || null;
  } else {
    const discovery = new runtime.DiscoveryEngine(config, normalizedPath);
    const appMap = await discovery.scanAppMap({
      targetUrl: config.project.targetUrl,
      authToken: String(options.authToken || ""),
      autoAuth: true,
      credentials: config.credentials,
    });
    routeTree = Array.isArray(appMap.routeTree) ? appMap.routeTree : [];
    folderTree = appMap.folderTree || folderTree;
    apiGraph = Array.isArray(appMap.apiGraph) ? appMap.apiGraph : [];
    authBoundaries = Array.isArray(appMap.authBoundaries) ? appMap.authBoundaries : [];
    appMapWarnings = Array.isArray(appMap.warnings) ? appMap.warnings : [];
    packageGroups = Array.isArray(appMap.packageGroups) ? appMap.packageGroups : [];
    openApiInfo = appMap.openApiInfo || openApiInfo;
    openApiSummary = String(appMap.openApiSummary || "");
    openApiDiagnostics = Array.isArray(appMap.openApiDiagnostics) ? appMap.openApiDiagnostics : [];
    authInfo = appMap.authInfo || null;
  }

  runtime.projectPath = normalizedPath;
  runtime.projectConfig = config;
  runtime.appMap = {
    folderTree,
    routeTree,
    apiGraph,
    authBoundaries,
    warnings: appMapWarnings,
    packageGroups,
    openApiInfo,
    openApiSummary,
    openApiDiagnostics,
    authInfo,
    scannedAt: new Date().toISOString(),
  };

  runtime.projectInfo = {
    name: config.project.name,
    projectPath: normalizedPath,
    framework: config.project.framework,
    version: config.project.version,
    targetUrl: config.project.targetUrl,
    dbType: config.project.dbType,
    schemaPath: "prisma/schema.prisma",
    routeMapSource: "runtime router registry",
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

function summarizeBySeverity(findings = []) {
  const summary = { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) {
    const severity = String(finding?.severity || "info").toLowerCase();
    summary.total += 1;
    if (summary[severity] !== undefined) {
      summary[severity] += 1;
    } else {
      summary.info += 1;
    }
  }
  return summary;
}

function normalizeFindingRecord(finding, source, index) {
  return {
    id: String(finding?.id || `${source}-${index + 1}`),
    source,
    severity: String(finding?.severity || "info").toLowerCase(),
    title: String(finding?.title || finding?.name || "Untitled finding"),
    endpoint: String(finding?.endpoint || finding?.url || "unknown"),
    description: String(finding?.description || finding?.what || ""),
    fix: String(finding?.fix || finding?.solution || ""),
  };
}

function clipText(value, maxLength = 220) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 3))}...`;
}

function normalizeProxyRequestForContext(request, index) {
  const requestRaw = String(request?.requestRaw || "").trim();
  const responseRaw = String(request?.responseRaw || "").trim();
  const requestBody = String(request?.requestBody || "").trim();
  const responseBody = String(request?.responseBody || "").trim();

  return {
    id: Number(request?.id || index + 1),
    timestamp: String(request?.timestamp || ""),
    method: String(request?.method || "GET").toUpperCase(),
    host: String(request?.host || ""),
    path: String(request?.path || "/"),
    status: Number(request?.responseStatus || request?.status || 0),
    durationMs: Number(request?.durationMs || request?.timeMs || 0),
    flag: String(request?.flag || "normal"),
    requestFormat: String(request?.requestFormat || "unknown"),
    responseFormat: String(request?.responseFormat || "unknown"),
    requestBytes: Number(request?.requestBytes || 0),
    responseBytes: Number(request?.responseBytes || 0),
    requestRaw: clipText(requestRaw || requestBody, 1800),
    responseRaw: clipText(responseRaw || responseBody, 1800),
  };
}

function summarizeProxyTraffic(requests = []) {
  const summary = {
    total: 0,
    suspicious: 0,
    finding: 0,
    flagged: 0,
    methods: {},
    statuses: {
      s2xx: 0,
      s3xx: 0,
      s4xx: 0,
      s5xx: 0,
      other: 0,
    },
  };

  for (const entry of requests) {
    summary.total += 1;

    const method = String(entry?.method || "GET").toUpperCase();
    summary.methods[method] = Number(summary.methods[method] || 0) + 1;

    const status = Number(entry?.responseStatus || entry?.status || 0);
    if (status >= 200 && status < 300) summary.statuses.s2xx += 1;
    else if (status >= 300 && status < 400) summary.statuses.s3xx += 1;
    else if (status >= 400 && status < 500) summary.statuses.s4xx += 1;
    else if (status >= 500) summary.statuses.s5xx += 1;
    else summary.statuses.other += 1;

    const flag = String(entry?.flag || "").toLowerCase();
    if (flag === "suspicious") summary.suspicious += 1;
    if (flag === "finding") summary.finding += 1;
    if (flag === "suspicious" || flag === "finding") summary.flagged += 1;
  }

  return summary;
}

function buildSummaryPrompt(context, extraPrompt = "") {
  const topFindings = (context?.findings || []).slice(0, 12).map((finding) => ({
    severity: finding.severity,
    source: finding.source,
    title: finding.title,
    endpoint: finding.endpoint,
    description: finding.description,
    fix: finding.fix,
  }));

  const payload = {
    project: {
      name: context?.project?.name || "unknown",
      framework: context?.project?.framework || "unknown",
      targetUrl: context?.project?.targetUrl || "",
    },
    summary: context?.summary || {},
    modules: {
      appMap: {
        routeCount: context?.appMap?.routeCount || 0,
        warningCount: Array.isArray(context?.appMap?.warnings) ? context.appMap.warnings.length : 0,
      },
      artemis: {
        findings: context?.artemis?.findingsCount || context?.nuclei?.findingsCount || 0,
        status: context?.artemis?.status?.phaseName || context?.nuclei?.status?.phaseName || "idle",
        lastError: context?.artemis?.status?.lastError || context?.nuclei?.status?.lastError || "",
        checksRun: Number(context?.artemis?.checksRun || 0),
      },
      browserUse: {
        testedRoutes: Number(context?.browserUse?.coverage?.uniqueRoutes || 0),
        uiPagesTested: Number(context?.browserUse?.coverage?.uiPagesTested || 0),
        apiRoutesTested: Number(context?.browserUse?.coverage?.apiRoutesTested || 0),
        authRoutesTested: Number(context?.browserUse?.coverage?.authRoutesTested || 0),
        llmHelpProbe: context?.browserUse?.llmHelpProbe || null,
      },
      proxy: {
        requestCount: context?.proxy?.requestCount || 0,
      },
      gitGate: {
        blockCritical: Boolean(context?.git?.gateRules?.blockCritical),
        blockHigh: Boolean(context?.git?.gateRules?.blockHigh),
        blockSecrets: Boolean(context?.git?.gateRules?.blockSecrets),
      },
    },
    topFindings,
  };

  return [
    "You are a senior application security reviewer.",
    "Generate a concise report summary for developers.",
    "Format:",
    "1) Executive Summary (3-5 bullet points)",
    "2) Highest Risks (ordered by severity)",
    "3) Immediate Fix Plan (5 actionable steps)",
    "4) Validation Checklist",
    "Keep it practical and evidence-based. Do not fabricate data.",
    extraPrompt ? `Additional instruction: ${extraPrompt}` : "",
    "Context JSON:",
    JSON.stringify(payload, null, 2),
  ]
    .filter(Boolean)
    .join("\n");
}

async function buildReportContext() {
  const project = runtime.projectInfo || {};
  const appMap = runtime.appMap || {};
  const scan = runtime.lastScan || {};
  const artemis = runtime.nucleiState || { status: null, findings: [] };

  const latestReportFindings = Array.isArray(runtime.latestReport?.findings)
    ? runtime.latestReport.findings
    : [];
  const scanFindings = Array.isArray(scan?.findings) ? scan.findings : [];
  const artemisFindings = Array.isArray(artemis?.findings) ? artemis.findings : [];
  const browserUseDocumentation = scan?.operations?.browserUse?.documentation
    || runtime.latestReport?.operations?.browserUse?.documentation
    || null;
  const browserUseCoverage = browserUseDocumentation?.coverage || {};
  const browserUseLlmProbe = browserUseDocumentation?.llmHelpProbe || null;

  const findings = [
    ...scanFindings.map((item, index) => normalizeFindingRecord(item, "scan", index)),
    ...artemisFindings.map((item, index) => normalizeFindingRecord(item, "artemis", index)),
    ...latestReportFindings.map((item, index) => normalizeFindingRecord(item, "report", index)),
  ];

  const summary = summarizeBySeverity(findings);

  let proxyStatus = { running: false, requestCount: 0, port: 8080 };
  let proxyRequests = [];
  if (runtime.proxyEngine) {
    try {
      proxyStatus = runtime.proxyEngine.getStatus();
      proxyRequests = runtime.proxyEngine.getRequests();
    } catch {}
  }
  const totalProxyCount = Number(proxyStatus?.requestCount || proxyRequests.length || 0);
  const proxySummary = summarizeProxyTraffic(proxyRequests);
  const proxyRecentRequests = proxyRequests.slice(-80).map(normalizeProxyRequestForContext);

  let containers = [];
  if (runtime.ContainerManager?.getStatus) {
    try {
      containers = await runtime.ContainerManager.getStatus();
    } catch {}
  }

  return {
    generatedAt: new Date().toISOString(),
    project: {
      name: String(project?.name || ""),
      framework: String(project?.framework || ""),
      targetUrl: String(project?.targetUrl || ""),
      projectPath: String(project?.projectPath || ""),
    },
    appMap: {
      routeCount: Array.isArray(appMap?.routeTree) ? appMap.routeTree.length : 0,
      folderTree: appMap?.folderTree || null,
      routes: Array.isArray(appMap?.routeTree) ? appMap.routeTree.slice(0, 80) : [],
      warnings: Array.isArray(appMap?.warnings) ? appMap.warnings : [],
      openApiSummary: String(appMap?.openApiSummary || ""),
      sourceMode: String(appMap?.sourceMode || "repo"),
      linkedSourcePath: String(appMap?.linkedSourcePath || ""),
    },
    scan: {
      mode: String(scan?.mode || ""),
      durationMs: Number(scan?.durationMs || 0),
      completedAt: String(scan?.completedAt || ""),
      findingsCount: scanFindings.length,
      summary: scan?.summary || summarizeBySeverity(scanFindings),
      operations: scan?.operations || {},
    },
    artemis: {
      status: artemis?.status || null,
      findingsCount: artemisFindings.length,
      findings: artemisFindings,
      checksRun: Array.isArray(scan?.operations?.artemis?.testsRun)
        ? scan.operations.artemis.testsRun.length
        : 0,
      endpointCount: Number(scan?.operations?.artemis?.endpointCount || 0),
    },
    browserUse: {
      documentation: browserUseDocumentation,
      coverage: {
        inputRoutes: Number(browserUseCoverage?.inputRoutes || 0),
        uniqueRoutes: Number(browserUseCoverage?.uniqueRoutes || 0),
        duplicatesSkipped: Number(browserUseCoverage?.duplicatesSkipped || 0),
        uiPagesTested: Number(browserUseCoverage?.uiPagesTested || 0),
        apiRoutesTested: Number(browserUseCoverage?.apiRoutesTested || 0),
        authRoutesTested: Number(browserUseCoverage?.authRoutesTested || 0),
      },
      llmHelpProbe: browserUseLlmProbe,
      instances: Array.isArray(browserUseDocumentation?.instances) ? browserUseDocumentation.instances : [],
    },
    nuclei: {
      status: artemis?.status || null,
      findingsCount: artemisFindings.length,
      findings: artemisFindings,
    },
    proxy: {
      status: proxyStatus,
      requestCount: totalProxyCount,
      recentRequests: proxyRecentRequests,
      summary: proxySummary,
    },
    git: {
      gateRules: runtime.gateRules || {},
      pushHistory: Array.isArray(runtime.pushHistory) ? runtime.pushHistory.slice(0, 20) : [],
    },
    docker: {
      containers,
    },
    findings,
    summary,
    latestReport: runtime.latestReport || null,
  };
}

async function generateLlmSummary(payload = {}) {
  const settings = {
    ...defaultSettings,
    ...(getStore().get("settings") || {}),
  };

  if (!settings.reportLlmEnabled) {
    return {
      ok: false,
      error: "AI summary is disabled in Settings > Report",
      code: 400,
      detail: "Enable reportLlmEnabled in Settings > Scanner (or Report) before generating summary",
    };
  }

  const endpoint = String(settings.reportLlmEndpoint || "https://api.groq.com/openai/v1/chat/completions").trim();
  const model = String(settings.reportLlmModel || "llama-3.1-8b-instant").trim();
  if (!endpoint || !model) {
    return {
      ok: false,
      error: "Missing LLM endpoint or model",
      code: 400,
      detail: "Configure reportLlmEndpoint and reportLlmModel in Settings > Scanner (or Report)",
    };
  }

  const apiKey = String(settings.reportLlmApiKey || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "Missing Groq API key",
      code: 400,
      detail: "Configure reportLlmApiKey in Settings > Scanner (or Report)",
    };
  }

  let context;
  try {
    context = await buildReportContext();
  } catch (error) {
    return {
      ok: false,
      error: "Failed to collect report context",
      code: 500,
      detail: String(error?.message || "buildReportContext failed"),
    };
  }

  const prompt = clipText(buildSummaryPrompt(context, String(payload?.extraPrompt || "").trim()), 12000);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "Dockium-Desktop/1.0",
    Authorization: /^bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`,
  };

  try {
    const fetchImpl = await resolveFetch();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: "You are Dockium report assistant. Return concise security summary text.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.2,
          max_tokens: 600,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const raw = await response.text();
    const parsed = safeJsonParse(raw);
    const summary = parsed.ok
      ? String(
        parsed.value?.choices?.[0]?.message?.content
        || parsed.value?.choices?.[0]?.text
        || parsed.value?.response
        || parsed.value?.message?.content
        || parsed.value?.output
        || ""
      ).trim()
      : "";

    if (!response.ok) {
      return {
        ok: false,
        error: `LLM request failed with HTTP ${response.status}`,
        code: response.status,
        detail: clipText(raw, 500),
      };
    }

    if (!summary) {
      return {
        ok: false,
        error: "LLM response did not include a summary",
        code: 502,
        detail: clipText(raw, 500),
      };
    }

    return {
      ok: true,
      summary,
      meta: {
        model,
        endpoint,
        generatedAt: new Date().toISOString(),
        totalFindings: Number(context?.summary?.total || 0),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: "LLM request failed",
      code: 500,
      detail: String(error?.message || "Network or parsing failure"),
    };
  }
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
    getSettings: () => ({
      ...defaultSettings,
      ...(getStore().get("settings") || {}),
    }),
    createScanOrchestrator: (config) => new runtime.ScanOrchestrator(config),
    ensureScanRuntime: async (config) => {
      if (runtime.ContainerManager?.ensureAppRunning) {
        await runtime.ContainerManager.ensureAppRunning({ ...config, wss: runtime.wss });
      }
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
    createNucleiScanner: (config) => new runtime.ArtemisScanner(config),
    ensureNucleiRuntime: async (config, options = {}) => {
      const preflight = {
        app: {
          ready: false,
          message: "",
        },
        scanner: {
          created: true,
          recreated: Boolean(options?.forceScannerRecreate),
          healthy: true,
          reason: "Artemis scanner runs locally without scanner container",
          status: "engine-local",
        },
      };

      if (runtime.ContainerManager?.ensureAppRunning) {
        await runtime.ContainerManager.ensureAppRunning({ ...config, wss: runtime.wss });
        preflight.app.ready = true;
        preflight.app.message = "App runtime is available";
      }

      runtime.wss?.emitLog("Artemis scanner preflight complete (containerless engine mode)");

      return preflight;
    },
    getWss: () => runtime.wss,
    onStateUpdate: (snapshot) => {
      runtime.nucleiState = {
        status: snapshot?.status || null,
        findings: Array.isArray(snapshot?.findings) ? snapshot.findings : [],
      };
    },
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
    getProjectInfo: () => runtime.projectInfo,
  });

  registerProjectIpc(ipcMain, {
    openProject,
    openImportedImage: hydrateImportedImageProject,
    getProjectInfo: () => runtime.projectInfo,
    getAppMap: () => runtime.appMap,
    getProjectConfig: () => runtime.projectConfig,
    getProjectPath: () => runtime.projectPath,
    scanAppMap: async (payload = {}) => {
      if (!runtime.projectConfig || !runtime.projectPath) {
        return runtime.appMap || {
          folderTree: { name: "project", type: "directory", children: [] },
          routeTree: [],
          apiGraph: [],
          authBoundaries: [],
          warnings: ["App-map scan is unavailable for this project context"],
        };
      }

      if (String(runtime.projectPath).startsWith("docker://")) {
        const enriched = await enrichImportedImageMap(
          runtime.appMap || buildImportedImageMap(runtime.projectConfig?.project?.name || "imported-image"),
          runtime.projectConfig?.project?.targetUrl,
          String(payload?.authToken || ""),
          {
            autoAuth: true,
            credentials: runtime.projectConfig?.credentials || {},
            sourceRepoPath: String(
              payload?.sourceRepoPath
              || runtime.projectConfig?.project?.sourceRepoPath
              || ""
            ),
          }
        );
        runtime.appMap = enriched;
        return enriched;
      }

      const discovery = new runtime.DiscoveryEngine(runtime.projectConfig, runtime.projectPath);
      const scanned = await discovery.scanAppMap({
        targetUrl: runtime.projectConfig?.project?.targetUrl,
        authToken: payload?.authToken,
        autoAuth: true,
        credentials: runtime.projectConfig?.credentials || {},
        onProgress: payload?.onProgress,
      });
      return scanned;
    },
    setAppMap: (nextMap) => {
      runtime.appMap = nextMap;
      runtime.projectInfo = {
        ...(runtime.projectInfo || {}),
        routeCount: Array.isArray(nextMap?.routeTree) ? nextMap.routeTree.length : 0,
        apiFlowCount: Array.isArray(nextMap?.apiGraph) ? nextMap.apiGraph.length : 0,
        linkedSourcePath: String(nextMap?.linkedSourcePath || runtime.projectInfo?.linkedSourcePath || ""),
      };
    },
    testRoute: async (route, options = {}) => {
      if (!runtime.projectConfig || !runtime.projectPath) {
        return {
          ok: false,
          error: "Route testing unavailable",
          code: 400,
          detail: "Missing project configuration",
        };
      }

      if (String(runtime.projectPath).startsWith("docker://")) {
        return await testImportedRoute(route, {
          targetUrl: runtime.projectConfig?.project?.targetUrl,
          authHeaders: options?.authHeaders || {},
          headers: options?.headers || {},
          body: options?.body,
          pathParams: options?.pathParams || options?.params || [],
          queryParams: options?.queryParams || [],
          method: options?.method || route?.method,
        });
      }

      const discovery = new runtime.DiscoveryEngine(runtime.projectConfig, runtime.projectPath);
      return await discovery.testRoute(route, {
        targetUrl: runtime.projectConfig?.project?.targetUrl,
        authHeaders: options?.authHeaders || {},
        headers: options?.headers || {},
        body: options?.body,
        pathParams: options?.pathParams || options?.params || [],
        queryParams: options?.queryParams || [],
        method: options?.method || route?.method,
      });
    },
  });

  registerFleetIpc(ipcMain, {
    runtime,
    getWss: () => runtime.wss,
    ensureProxyEngine: (config = {}) => {
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
  });

  registerReportIpc(ipcMain, BrowserWindow, dialog, {
    getLatestReport: () => runtime.latestReport,
    getReportContext: buildReportContext,
    generateLlmSummary: generateLlmSummary,
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

    store.set("onboarding", next);

    if (statePayload.projectLoaded && !statePayload.deferProjectOpen) {
      queueProjectRestore("onboarding:set-state");
    }

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
    backgroundColor: "#ffffff",
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
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  let launchFallbackTimer = null;
  const showMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (launchFallbackTimer) {
      clearTimeout(launchFallbackTimer);
      launchFallbackTimer = null;
    }

    hideSplash();
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.webContents.send("window:maximize-changed", {
      isMaximized: mainWindow.isMaximized(),
    });
  };

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
    showMainWindow();
  });

  mainWindow.once("ready-to-show", () => {
    showMainWindow();
  });

  // Never keep splash indefinitely if renderer warmup is slow.
  launchFallbackTimer = setTimeout(() => {
    showMainWindow();
  }, 9000);

  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:maximize-changed", { isMaximized: true });
  });

  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:maximize-changed", { isMaximized: false });
  });

  mainWindow.on("closed", () => {
    if (launchFallbackTimer) {
      clearTimeout(launchFallbackTimer);
      launchFallbackTimer = null;
    }
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

async function restoreProjectFromOnboardingState() {
  const store = getStore();
  const onboarding = store.get("onboarding") || {};

  if (!onboarding?.projectLoaded) {
    return;
  }

  if (runtime.projectConfig?.project?.targetUrl && runtime.projectPath) {
    return;
  }

  const importedMode = Boolean(onboarding.importedMode)
    || String(onboarding.projectPath || "").startsWith("docker://")
    || Boolean(onboarding.importedImage);

  if (importedMode && onboarding.importedImage) {
    await hydrateImportedImageProject(onboarding.importedImage, {
      ...(onboarding.config || {}),
      sourceRepoPath: String(onboarding.config?.sourceRepoPath || onboarding.sourceRepoPath || ""),
    });
    runtime.wss?.emitLog(`Restored imported image context: ${onboarding.importedImage}`);
    return;
  }

  if (onboarding.projectPath) {
    await openProject(onboarding.projectPath, onboarding.config || {});
    runtime.wss?.emitLog(`Restored project context: ${onboarding.projectPath}`);
    return;
  }

  runtime.wss?.emitLog("Onboarding state had projectLoaded=true but no project path/image", "warn");
}

function queueProjectRestore(source = "unknown") {
  if (projectRestoreInFlight) {
    return projectRestoreInFlight;
  }

  projectRestoreInFlight = (async () => {
    try {
      await restoreProjectFromOnboardingState();
    } catch (error) {
      runtime.wss?.emitLog(
        `Failed to restore onboarding project context (${source}): ${error.message}`,
        "warn"
      );
    } finally {
      projectRestoreInFlight = null;
    }
  })();

  return projectRestoreInFlight;
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
    queueProjectRestore("startup");

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
