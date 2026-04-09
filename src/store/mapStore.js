import { create } from "zustand";

function nodeIdFromPath(pathValue, fallback) {
  return String(pathValue || fallback || "node").replace(/[^a-zA-Z0-9/_-]/g, "_");
}

function normalizeTreeNode(node, parentPath = "") {
  const nodePath = String(node?.path || parentPath || "").replace(/\\/g, "/");
  const type = String(node?.type || "directory").toLowerCase();
  const kind = type === "file" ? "file" : "folder";
  const id = nodeIdFromPath(nodePath || node?.name, `${parentPath}/${node?.name || "node"}`);

  return {
    id,
    name: String(node?.name || ""),
    kind,
    path: nodePath,
    routeCount: Number(node?.routeCount || 0),
    packageName: String(node?.packageName || ""),
    annotation: node?.annotation || null,
    children: Array.isArray(node?.children)
      ? node.children.map((child) => normalizeTreeNode(child, nodePath))
      : [],
  };
}

function normalizeRoute(route, index) {
  return {
    id: route?.id || `route-${index + 1}`,
    method: String(route?.method || "GET").toUpperCase(),
    path: String(route?.path || "/"),
    fullPath: String(route?.fullPath || route?.path || "/"),
    handlerName: String(route?.handlerName || "anonymous-handler"),
    middlewareChain: Array.isArray(route?.middlewareChain) ? route.middlewareChain : [],
    authRequired: Boolean(route?.authRequired),
    authStatus: String(route?.authStatus || (route?.authRequired ? "AUTH REQUIRED" : "PUBLIC")),
    roles: Array.isArray(route?.roles) ? route.roles : [],
    permissions: Array.isArray(route?.permissions) ? route.permissions : [],
    rateLimit: route?.rateLimit || null,
    sourceFile: String(route?.sourceFile || "unresolved"),
    sourceLine: Number(route?.sourceLine || 1),
    packageName: String(route?.packageName || "project"),
    sourceReadable: route?.sourceReadable !== false,
    sourceWarning: String(route?.sourceWarning || ""),
    request: {
      pathParams: Array.isArray(route?.request?.pathParams) ? route.request.pathParams : [],
      queryParams: Array.isArray(route?.request?.queryParams) ? route.request.queryParams : [],
      bodySchema: route?.request?.bodySchema || null,
    },
    response: {
      statusCodes: Array.isArray(route?.response?.statusCodes) ? route.response.statusCodes : [],
      bodySchema: route?.response?.bodySchema || null,
      contentType: String(route?.response?.contentType || "application/json"),
    },
    openApi: route?.openApi || null,
    liveRequest: route?.liveRequest || null,
    liveResponse: route?.liveResponse || null,
  };
}

function normalizeAppMap(rawAppMap = {}) {
  const folderTreeRaw = rawAppMap?.folderTree;
  const folderTree = folderTreeRaw && typeof folderTreeRaw === "object"
    ? normalizeTreeNode(folderTreeRaw)
    : normalizeTreeNode({ name: "project", type: "directory", path: "", children: [] });

  const routes = Array.isArray(rawAppMap?.routeTree)
    ? rawAppMap.routeTree.map(normalizeRoute)
    : [];

  return {
    sourceMode: String(rawAppMap?.sourceMode || "repo"),
    folderTree,
    routes,
    warnings: Array.isArray(rawAppMap?.warnings) ? rawAppMap.warnings : [],
    openApiSummary: String(rawAppMap?.openApiSummary || ""),
    openApiDiagnostics: Array.isArray(rawAppMap?.openApiDiagnostics) ? rawAppMap.openApiDiagnostics : [],
    authInfo: rawAppMap?.authInfo || null,
    linkedSourcePath: String(rawAppMap?.linkedSourcePath || ""),
    packageGroups: Array.isArray(rawAppMap?.packageGroups) ? rawAppMap.packageGroups : [],
    openApiInfo: rawAppMap?.openApiInfo || { title: "", version: "" },
    scannedAt: rawAppMap?.scannedAt || null,
  };
}

function collectExpandedFolders(node, out = {}) {
  if (!node || node.kind !== "folder") {
    return out;
  }

  out[node.id] = true;
  (node.children || []).forEach((child) => collectExpandedFolders(child, out));
  return out;
}

function parseJsonLoose(input, fallback) {
  const raw = String(input || "").trim();
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseHeaders(value) {
  const json = parseJsonLoose(value, null);
  if (json && typeof json === "object" && !Array.isArray(json)) {
    return json;
  }

  const result = {};
  String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) {
        return;
      }
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key) {
        result[key] = val;
      }
    });

  return result;
}

function parseParams(value) {
  const parsed = parseJsonLoose(value, null);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => ({ name: String(item?.name || ""), value: String(item?.value || "") }))
      .filter((item) => item.name);
  }

  return String(value || "")
    .split(/[&\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf("=");
      if (idx === -1) {
        return { name: entry, value: "" };
      }
      return {
        name: entry.slice(0, idx).trim(),
        value: entry.slice(idx + 1).trim(),
      };
    })
    .filter((item) => item.name);
}

function defaultTestDraft(route) {
  const pathParams = Array.isArray(route?.request?.pathParams)
    ? route.request.pathParams.map((item) => `${item.name}=1`).join("\n")
    : "";
  const queryParams = Array.isArray(route?.request?.queryParams)
    ? route.request.queryParams.map((item) => `${item.name}=sample`).join("\n")
    : "";
  const body = route?.request?.bodySchema ? JSON.stringify(route.request.bodySchema, null, 2) : "{}";
  return {
    open: false,
    loading: false,
    headersText: "{}",
    paramsText: pathParams,
    queryText: queryParams,
    bodyText: body,
    result: null,
    error: "",
  };
}

function isLoginRoute(route) {
  const pathValue = String(route?.path || route?.fullPath || "").toLowerCase();
  const method = String(route?.method || "GET").toUpperCase();
  if (method !== "POST") {
    return false;
  }
  return /(login|signin|auth|session|token)/.test(pathValue);
}

function isRegisterRoute(route) {
  const pathValue = String(route?.path || route?.fullPath || "").toLowerCase();
  const method = String(route?.method || "GET").toUpperCase();
  if (method !== "POST") {
    return false;
  }
  return /(register|signup|create[-_]?account|users)/.test(pathValue);
}

function isUiAuthPageRoute(route) {
  const pathValue = String(route?.path || route?.fullPath || "").toLowerCase();
  const method = String(route?.method || "GET").toUpperCase();
  if (method !== "GET") {
    return false;
  }
  if (pathValue.startsWith("/api") || pathValue.startsWith("/rest")) {
    return false;
  }
  return /(login|signin|register|signup)/.test(pathValue);
}

const MAX_AUTH_ROUTE_CANDIDATES = 3;
const MAX_LOGIN_SEED_CANDIDATES = 10;
const MAX_POST_AUTH_SWEEP_ROUTES = 80;

function authRoutePriority(route, kind) {
  const pathValue = String(route?.path || route?.fullPath || "").toLowerCase();
  const sourceFile = String(route?.sourceFile || "").toLowerCase();
  let score = 0;

  if (/\/api\//.test(pathValue)) {
    score -= 4;
  } else if (/\/rest\//.test(pathValue)) {
    score -= 2;
  }

  if (kind === "login") {
    if (/(login|signin|session|token|auth)/.test(pathValue)) {
      score -= 3;
    }
  } else {
    if (/(register|signup|create[-_]?account)/.test(pathValue)) {
      score -= 3;
    }
    if (/users/.test(pathValue)) {
      score -= 1;
    }
    if (/\/api\/users\/?$/.test(pathValue)) {
      score -= 6;
    }
    if (/\/rest\/user\/signup\/?$/.test(pathValue)) {
      score += 12;
    }
  }

  if (/(swagger|openapi|docs|mock|example)/.test(pathValue)) {
    score += 8;
  }
  if (/(node_modules|dist|build)/.test(sourceFile)) {
    score += 3;
  }

  return score;
}

function dedupeRouteCandidates(candidates = []) {
  const seen = new Set();
  const out = [];
  candidates.forEach((route) => {
    const method = String(route?.method || "GET").toUpperCase();
    const pathValue = String(route?.path || route?.fullPath || "");
    const key = `${method} ${pathValue}`;
    if (!pathValue || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(route);
  });
  return out;
}

function createSyntheticRoute(pathValue, source = "synthetic-register-fallback") {
  const normalizedPath = String(pathValue || "").trim();
  return {
    id: `${source}-${normalizedPath.replace(/[^a-zA-Z0-9/_-]/g, "_")}`,
    method: "POST",
    path: normalizedPath,
    fullPath: normalizedPath,
    handlerName: source,
    middlewareChain: [],
    authRequired: false,
    authStatus: "PUBLIC",
    sourceFile: source,
    sourceLine: 1,
    request: {
      pathParams: [],
      queryParams: [],
      bodySchema: null,
    },
    response: {
      statusCodes: [],
      bodySchema: null,
      contentType: "application/json",
    },
  };
}

function buildRegisterFallbackCandidates(routes = [], loginCandidates = []) {
  const staticPaths = [
    "/api/users",
    "/api/users/",
    "/api/Users",
    "/api/Users/",
  ];

  const fromRoutes = routes
    .filter((route) => {
      const method = String(route?.method || "GET").toUpperCase();
      const pathValue = String(route?.path || route?.fullPath || "").toLowerCase();
      return method === "POST" && /\/api\//.test(pathValue) && /users?/.test(pathValue);
    })
    .map((route) => String(route?.path || route?.fullPath || "").trim())
    .filter(Boolean);

  const fromLogin = loginCandidates
    .map((route) => String(route?.path || route?.fullPath || "").trim())
    .filter(Boolean)
    .flatMap((pathValue) => {
      const lower = pathValue.toLowerCase();
      if (/\/rest\/user\/(login|signin|session|token|auth)/.test(lower)) {
        return ["/api/users", "/api/Users", "/api/Users/"];
      }
      return [];
    });

  return [...new Set([...fromRoutes, ...fromLogin, ...staticPaths])]
    .map((pathValue) => createSyntheticRoute(pathValue));
}

function pickAuthRouteCandidates(routes = [], kind = "login") {
  const matcher = kind === "register" ? isRegisterRoute : isLoginRoute;
  return routes
    .filter((route) => matcher(route))
    .sort((a, b) => {
      const diff = authRoutePriority(a, kind) - authRoutePriority(b, kind);
      if (diff !== 0) {
        return diff;
      }
      return String(a?.path || "").localeCompare(String(b?.path || ""));
    })
    .slice(0, MAX_AUTH_ROUTE_CANDIDATES);
}

function sampleValueFromSchema(schema, fallback = "sample") {
  if (!schema || typeof schema !== "object") {
    return fallback;
  }

  const schemaType = String(schema.type || "").toLowerCase();
  if (schemaType === "number" || schemaType === "integer") {
    return 1;
  }
  if (schemaType === "boolean") {
    return true;
  }
  if (schemaType === "array") {
    return [];
  }
  if (schemaType === "object") {
    const props = schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : {};
    const out = {};
    Object.keys(props).forEach((key) => {
      out[key] = sampleValueFromSchema(props[key], key);
    });
    return out;
  }
  return fallback;
}

function resolveValueForField(fieldName, values = {}) {
  const key = String(fieldName || "").toLowerCase();
  if (key.includes("email")) return values.email;
  if (key.includes("user") || key.includes("login") || key.includes("identifier")) return values.username;
  if (key.includes("pass")) return values.password;
  if (key.includes("name")) return values.name;
  if (key.includes("token")) return values.token;
  return values.fallback;
}

function buildAuthPayload(route, kind, credentialSeed = {}) {
  const schema = route?.request?.bodySchema;
  const seedEmail = String(credentialSeed?.email || "user@dockium.local").trim();
  const seedPassword = String(credentialSeed?.password || "Password123!").trim();
  const usernamePart = seedEmail.includes("@") ? seedEmail.slice(0, seedEmail.indexOf("@")) : seedEmail;
  const registerEmail = `${usernamePart || "dockium"}+${Date.now()}@example.com`;

  const values = {
    email: kind === "register" ? registerEmail : seedEmail,
    username: kind === "register" ? registerEmail : (usernamePart || seedEmail),
    password: seedPassword,
    name: "Dockium Test User",
    securityQuestionId: Number(credentialSeed?.securityQuestionId || 1) || 1,
    securityQuestionObject: credentialSeed?.securityQuestionObject && typeof credentialSeed.securityQuestionObject === "object"
      ? credentialSeed.securityQuestionObject
      : { id: Number(credentialSeed?.securityQuestionId || 1) || 1 },
    securityAnswer: String(credentialSeed?.securityAnswer || "dockium-generic-answer").trim() || "dockium-generic-answer",
    token: "",
    fallback: kind,
  };

  if (schema && typeof schema === "object") {
    const sampled = sampleValueFromSchema(schema, kind === "login" ? "credential" : "value");
    if (sampled && typeof sampled === "object") {
      const hydrated = { ...sampled };
      Object.keys(hydrated).forEach((field) => {
        hydrated[field] = resolveValueForField(field, values);
      });
      if (Object.keys(hydrated).length > 0) {
        return hydrated;
      }
    }
  }

  if (kind === "login") {
    return {
      email: values.email,
      username: values.username,
      login: values.username,
      password: values.password,
      identifier: values.email,
    };
  }

  return {
    email: values.email,
    username: values.username,
    login: values.username,
    password: values.password,
    confirmPassword: values.password,
    passwordRepeat: values.password,
    repeatPassword: values.password,
    confirm: values.password,
    name: values.name,
    securityQuestion: values.securityQuestionObject,
    securityQuestionId: values.securityQuestionId,
    securityAnswer: values.securityAnswer,
  };
}

function uniquePayloadVariants(variants = []) {
  const out = [];
  const seen = new Set();

  variants.forEach((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }

    const normalized = {};
    Object.keys(entry)
      .sort((a, b) => a.localeCompare(b))
      .forEach((key) => {
        normalized[key] = entry[key];
      });

    const key = JSON.stringify(normalized);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    out.push(entry);
  });

  return out;
}

function buildUiHintPayload(fields = [], values = {}) {
  if (!Array.isArray(fields) || fields.length === 0) {
    return null;
  }

  const payload = {};
  fields.slice(0, 14).forEach((field) => {
    const key = String(field || "").trim();
    if (!key || /search|query|csrf|tokenized/.test(key)) {
      return;
    }
    payload[key] = resolveValueForField(key, values);
  });

  return Object.keys(payload).length > 0 ? payload : null;
}

function authPayloadVariants(route, kind, credentialSeed = {}, uiHints = null) {
  const base = buildAuthPayload(route, kind, credentialSeed);
  const email = String(base.email || credentialSeed?.email || "user@dockium.local");
  const username = String(base.username || email.split("@")[0] || "dockium");
  const password = String(base.password || credentialSeed?.password || "Password123!");
  const name = String(base.name || "Dockium Test User");
  const pathValue = String(route?.path || route?.fullPath || "").toLowerCase();
  const isApiUsersRegister = kind === "register" && /\/api\/users\/?$/.test(pathValue);
  const securityQuestionId = Number(credentialSeed?.securityQuestionId || base?.securityQuestionId || 1) || 1;
  const securityQuestionObject = credentialSeed?.securityQuestionObject && typeof credentialSeed.securityQuestionObject === "object"
    ? credentialSeed.securityQuestionObject
    : (base?.securityQuestion && typeof base.securityQuestion === "object" ? base.securityQuestion : { id: securityQuestionId });
  const securityAnswer = String(credentialSeed?.securityAnswer || base?.securityAnswer || "dockium-generic-answer").trim() || "dockium-generic-answer";
  const uiFields = kind === "login"
    ? (Array.isArray(uiHints?.loginFields) ? uiHints.loginFields : [])
    : (Array.isArray(uiHints?.registerFields) ? uiHints.registerFields : []);
  const uiPayload = buildUiHintPayload(uiFields, {
    email,
    username,
    password,
    name,
    securityQuestion: securityQuestionId,
    securityQuestionId,
    securityAnswer,
    fallback: kind,
  });

  if (kind === "login") {
    return uniquePayloadVariants([
      uiPayload,
      { email, password },
      { username, password },
      { email: username, password },
      { login: username, password },
      { identifier: email, password },
      { emailOrUsername: email, password },
      { user: { email, password } },
      { credentials: { email, password } },
      base,
    ]);
  }

  const apiUsersPriorityPayloads = isApiUsersRegister
    ? [
      {
        email,
        password,
        passwordRepeat: password,
        securityQuestion: String(securityQuestionId),
        securityAnswer,
      },
      {
        email,
        password,
        passwordRepeat: password,
        securityQuestion: securityQuestionId,
        securityAnswer,
      },
      {
        email,
        password,
        passwordRepeat: password,
        securityQuestionId,
        securityAnswer,
      },
    ]
    : [];

  return uniquePayloadVariants([
    ...apiUsersPriorityPayloads,
    uiPayload,
    {
      email,
      password,
      passwordRepeat: password,
      securityQuestion: securityQuestionObject,
      securityAnswer,
    },
    {
      email,
      password,
      passwordRepeat: password,
    },
    {
      email,
      password,
      confirmPassword: password,
    },
    { email, username, password, name },
    {
      email,
      password,
      confirmPassword: password,
      passwordRepeat: password,
      securityQuestion: securityQuestionObject,
      securityQuestionId,
      securityAnswer,
      name,
    },
    {
      email,
      password,
      passwordRepeat: password,
      repeatPassword: password,
      securityQuestion: securityQuestionObject,
      securityQuestionId,
      securityAnswer,
      name,
    },
    { username, password, confirmPassword: password, passwordRepeat: password, repeatPassword: password, name },
    { email, username, password, name, securityQuestionId, securityAnswer },
    { login: username, password, confirmPassword: password, passwordRepeat: password, repeatPassword: password, name },
    { email, password, passwordConfirmation: password, name },
    base,
  ]);
}

function credentialCandidates(config = {}) {
  const credentials = config?.credentials && typeof config.credentials === "object"
    ? config.credentials
    : {};

  const candidates = [];
  const testUserEmail = String(credentials.testUserEmail || "").trim();
  const testUserPass = String(credentials.testUserPass || "").trim();
  if (testUserEmail && testUserPass) {
    candidates.push({ email: testUserEmail, password: testUserPass, source: "test-user" });
  }

  const adminEmail = String(credentials.adminEmail || "").trim();
  const adminPassword = String(credentials.adminPassword || "").trim();
  if (adminEmail && adminPassword) {
    candidates.push({ email: adminEmail, password: adminPassword, source: "admin-user" });
  }

  if (candidates.length === 0) {
    candidates.push({ email: "user@dockium.local", password: "Password123!", source: "fallback" });
    candidates.push({ email: "test@example.com", password: "Password123!", source: "fallback-alt-1" });
    candidates.push({ email: "admin@example.com", password: "Password123!", source: "fallback-alt-2" });
  }

  const commonKnownCredentials = [
    { email: "admin@juice-sh.op", password: "admin123", source: "known-juice-shop-admin" },
    { email: "jim@juice-sh.op", password: "ncc-1701", source: "known-juice-shop-jim" },
    { email: "bender@juice-sh.op", password: "Ikillyou", source: "known-juice-shop-bender" },
  ];

  commonKnownCredentials.forEach((entry) => candidates.push(entry));

  const unique = [];
  const seen = new Set();
  candidates.forEach((candidate) => {
    const email = String(candidate?.email || "").trim().toLowerCase();
    const password = String(candidate?.password || "").trim();
    if (!email || !password) {
      return;
    }
    const key = `${email}::${password}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    unique.push({ ...candidate, email, password });
  });

  return unique;
}

function isProtectedRoute(route) {
  const method = String(route?.method || "GET").toUpperCase();
  if (method !== "GET") {
    return false;
  }
  if (route?.authRequired) {
    return true;
  }
  const pathValue = String(route?.path || route?.fullPath || "").toLowerCase();
  return /(\/me|\/profile|\/account|\/users\/|\/admin)/.test(pathValue);
}

function protectedRouteScore(route) {
  const pathValue = String(route?.path || route?.fullPath || "").toLowerCase();
  if (/(\/me|\/whoami|\/profile|\/account)/.test(pathValue)) {
    return 0;
  }
  if (/\/users\//.test(pathValue) && !/\/admin/.test(pathValue)) {
    return 1;
  }
  if (/\/admin/.test(pathValue)) {
    return 5;
  }
  return route?.authRequired ? 2 : 3;
}

function parseBodyPreviewAsJson(result) {
  const raw = String(result?.liveResponse?.bodyPreview || "").trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getBodyPreviewText(result) {
  return String(result?.liveResponse?.bodyPreview || "").trim();
}

function normalizeEmailLike(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return String(fallback || "").trim();
  }
  if (raw.includes("@")) {
    return raw.toLowerCase();
  }
  return `${raw.toLowerCase()}@example.com`;
}

function registerResponseMissingIdentity(result) {
  const raw = getBodyPreviewText(result);
  const payload = parseBodyPreviewAsJson(result);
  if (!payload || typeof payload !== "object") {
    const lower = raw.toLowerCase();
    if (!lower) {
      return false;
    }
    const hasNullOrEmptyEmail = /"email"\s*:\s*(null|""|"\s*")/.test(lower);
    const hasNullOrEmptyUsername = /"username"\s*:\s*(null|""|"\s*")/.test(lower);
    return hasNullOrEmptyEmail && hasNullOrEmptyUsername;
  }

  const root = payload?.data && typeof payload.data === "object"
    ? payload.data
    : (payload?.user && typeof payload.user === "object" ? payload.user : payload);
  const hasEmailField = Object.prototype.hasOwnProperty.call(root || {}, "email");
  if (!hasEmailField) {
    return false;
  }

  const email = normalizeEmailLike(root?.email, "");
  const username = String(root?.username || root?.login || "").trim();
  return !email && !username;
}

function extractUiInputFieldHints(html = "") {
  const text = String(html || "");
  if (!text) {
    return [];
  }

  const matches = text.match(/<input\b[^>]*>/gi) || [];
  const fields = [];
  const seen = new Set();
  for (const tag of matches) {
    const nameMatch = tag.match(/\bname\s*=\s*['\"]([^'\"]+)['\"]/i);
    const idMatch = tag.match(/\bid\s*=\s*['\"]([^'\"]+)['\"]/i);
    const autoCompleteMatch = tag.match(/\bautocomplete\s*=\s*['\"]([^'\"]+)['\"]/i);
    const candidates = [nameMatch?.[1], idMatch?.[1], autoCompleteMatch?.[1]]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      const normalized = candidate.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      fields.push(normalized);
    }
  }

  return fields;
}

function mergeFieldHints(target = [], incoming = []) {
  const merged = new Set(Array.isArray(target) ? target : []);
  (Array.isArray(incoming) ? incoming : []).forEach((field) => {
    const value = String(field || "").trim().toLowerCase();
    if (value) {
      merged.add(value);
    }
  });
  return [...merged];
}

function extractTokenFromObject(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const direct = [
    payload.token,
    payload.access_token,
    payload.accessToken,
    payload.jwt,
    payload.id_token,
    payload.idToken,
    payload.authToken,
  ];
  for (const candidate of direct) {
    const value = String(candidate || "").trim();
    if (value) {
      return value;
    }
  }

  for (const nested of [payload.data, payload.result, payload.user, payload.authentication]) {
    const nestedToken = extractTokenFromObject(nested);
    if (nestedToken) {
      return nestedToken;
    }
  }

  return "";
}

function extractAuthArtifact(result) {
  const payload = parseBodyPreviewAsJson(result);
  const token = extractTokenFromObject(payload);
  const headers = result?.liveResponse?.headers && typeof result.liveResponse.headers === "object"
    ? result.liveResponse.headers
    : {};
  const setCookieRaw = headers["set-cookie"] || headers["Set-Cookie"] || "";
  const cookie = String(Array.isArray(setCookieRaw) ? setCookieRaw[0] : setCookieRaw)
    .split(";")[0]
    .trim();
  return {
    token,
    cookie,
  };
}

function extractSecurityQuestionSeed(result) {
  const payload = parseBodyPreviewAsJson(result);
  const root = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.result)
        ? payload.result
        : [];

  const first = root.find((entry) => entry && typeof entry === "object") || null;
  const id = Number(first?.id || first?.questionId || 0);
  if (!id) {
    return null;
  }

  return {
    securityQuestionId: id,
    securityQuestionObject: first,
    securityAnswer: "dockium-generic-answer",
  };
}

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_DEFAULT_MODEL = "llama-3.1-8b-instant";
const GROQ_AUTH_PROMPT_MAX_CHARS = 2200;
const GROQ_AUTH_MAX_TOKENS = 220;

function clipText(value, maxLength = 420) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 3))}...`;
}

function parseAiPayloadCandidates(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) {
    return [];
  }

  const direct = parseJsonLoose(raw, null);
  if (Array.isArray(direct)) {
    return direct.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
  }
  if (direct && typeof direct === "object") {
    if (Array.isArray(direct.payloads)) {
      return direct.payloads.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
    }
    if (direct.payload && typeof direct.payload === "object" && !Array.isArray(direct.payload)) {
      return [direct.payload];
    }
  }

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fencedMatch) {
    return [];
  }

  const fencedParsed = parseJsonLoose(String(fencedMatch[1] || "").trim(), null);
  if (Array.isArray(fencedParsed)) {
    return fencedParsed.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
  }
  if (fencedParsed && typeof fencedParsed === "object") {
    if (Array.isArray(fencedParsed.payloads)) {
      return fencedParsed.payloads.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
    }
    if (fencedParsed.payload && typeof fencedParsed.payload === "object" && !Array.isArray(fencedParsed.payload)) {
      return [fencedParsed.payload];
    }
  }

  return [];
}

async function suggestAiAuthPayloads(route, kind, credentialSeed, attemptedStatuses = [], failurePreview = "") {
  const settings = await window.dockium?.settingsGetAll?.();
  const enabled = settings?.reportLlmEnabled === true;
  const endpoint = String(settings?.reportLlmEndpoint || GROQ_CHAT_COMPLETIONS_URL).trim() || GROQ_CHAT_COMPLETIONS_URL;
  const model = String(settings?.reportLlmModel || GROQ_DEFAULT_MODEL).trim() || GROQ_DEFAULT_MODEL;
  const apiKey = String(settings?.reportLlmApiKey || "").trim();

  if (!enabled) {
    return {
      attempted: false,
      status: 0,
      detail: "LLM payload suggestion skipped because reportLlmEnabled=false.",
      payloads: [],
    };
  }

  if (!apiKey) {
    return {
      attempted: false,
      status: 0,
      detail: "LLM payload suggestion skipped because Groq API key is missing.",
      payloads: [],
    };
  }

  const seedEmail = String(credentialSeed?.email || "").trim();
  const seedUsername = String(credentialSeed?.username || seedEmail.split("@")[0] || "").trim();
  const seedPassword = String(credentialSeed?.password || "Password123!").trim();
  const pathValue = String(route?.path || route?.fullPath || "");

  const prompt = [
    "You are helping API auth compatibility testing.",
    "Return JSON only. No markdown.",
    `Task: provide at most 4 candidate ${kind} request payload objects for endpoint path ${pathValue}.`,
    "Use only plain object payloads. securityQuestion may be nested.",
    "Common fields: email, username, login, identifier, password, passwordRepeat, confirmPassword, securityQuestion, securityAnswer, name.",
    `Credential seed email: ${seedEmail}`,
    `Credential seed username: ${seedUsername}`,
    `Credential seed password: ${seedPassword}`,
    `Recent attempted statuses: ${attemptedStatuses.join(",") || "none"}`,
    `Recent failure response hint: ${clipText(failurePreview, 160) || "none"}`,
    "Output format: {\"payloads\":[{...},{...}]}",
  ].join("\n");

  const promptBudgeted = clipText(prompt, GROQ_AUTH_PROMPT_MAX_CHARS);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: /^bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`,
        "User-Agent": "Dockium-AppMap/1.0",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Return only valid JSON payload candidates." },
          { role: "user", content: promptBudgeted },
        ],
        temperature: 0.2,
        max_tokens: GROQ_AUTH_MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    const status = Number(response.status || 0);
    const raw = await response.text();
    const parsed = parseJsonLoose(raw, null);
    const modelText = String(
      parsed?.choices?.[0]?.message?.content
      || parsed?.choices?.[0]?.text
      || parsed?.response
      || parsed?.message?.content
      || parsed?.output
      || raw
    );

    if (!response.ok) {
      return {
        attempted: true,
        status,
        detail: `LLM payload suggestion failed with status ${status}.`,
        payloads: [],
      };
    }

    const payloads = uniquePayloadVariants(parseAiPayloadCandidates(modelText)).slice(0, 4);
    return {
      attempted: true,
      status,
      detail: payloads.length > 0
        ? `LLM suggested ${payloads.length} auth payload candidate(s).`
        : "LLM returned no parseable payload candidates.",
      payloads,
    };
  } catch (error) {
    return {
      attempted: true,
      status: 0,
      detail: String(error?.message || "LLM payload suggestion failed"),
      payloads: [],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function syncDataFromAppMap(set, appMap, scanStatus) {
  const normalized = normalizeAppMap(appMap || {});
  const expandedFolders = collectExpandedFolders(normalized.folderTree, {});
  set((state) => ({
    loading: false,
    error: "",
    folderTree: normalized.folderTree,
    routes: normalized.routes,
    sourceMode: normalized.sourceMode,
    warnings: normalized.warnings,
    openApiSummary: normalized.openApiSummary,
    openApiDiagnostics: normalized.openApiDiagnostics,
    authInfo: normalized.authInfo,
    linkedSourcePath: normalized.linkedSourcePath,
    packageGroups: normalized.packageGroups,
    openApiInfo: normalized.openApiInfo,
    scannedAt: normalized.scannedAt,
    expandedFolders,
    selectedRouteId: state.selectedRouteId && normalized.routes.some((route) => route.id === state.selectedRouteId)
      ? state.selectedRouteId
      : (normalized.routes[0]?.id || null),
    selectedFilePath: state.selectedFilePath || "",
    fileFilterPath: state.fileFilterPath || "",
    scanStatus: scanStatus || state.scanStatus,
  }));
}

const defaultScanStatus = {
  active: false,
  scanId: null,
  startedAt: null,
  completedAt: null,
  lastError: "",
  warnings: [],
  groups: {
    routes: { status: "idle", message: "" },
    tree: { status: "idle", message: "" },
    api: { status: "idle", message: "" },
  },
};

export const useMapStore = create((set, get) => ({
  loading: false,
  error: "",
  folderTree: normalizeTreeNode({ name: "project", type: "directory", path: "", children: [] }),
  routes: [],
  sourceMode: "repo",
  warnings: [],
  openApiSummary: "",
  openApiDiagnostics: [],
  authInfo: null,
  linkedSourcePath: "",
  packageGroups: [],
  openApiInfo: { title: "", version: "" },
  scannedAt: null,
  scanStatus: defaultScanStatus,
  searchQuery: "",
  methodFilter: "ALL",
  authFilter: "ALL",
  tokenInput: "",
  appliedToken: "",
  selectedRouteId: null,
  selectedFilePath: "",
  fileFilterPath: "",
  expandedFolders: {},
  expandedRoutes: {},
  routeTests: {},
  authRouteChecks: {
    loading: false,
    error: "",
    lastRunAt: null,
    results: [],
    workflow: null,
  },

  hydrate: async () => {
    set({ loading: true, error: "" });
    try {
      const infoResponse = await window.dockium?.project?.getInfo?.();
      const hasProjectContext = Boolean(infoResponse?.ok && infoResponse?.projectInfo?.projectPath);
      if (!hasProjectContext) {
        set({
          loading: false,
          error: "No project loaded. Open or import a project from New Project Setup.",
        });
        return;
      }

      const response = await window.dockium?.project?.getAppMap?.();
      if (!response?.ok) {
        set({ loading: false, error: String(response?.error || "Failed to load app map") });
        return;
      }
      const savedToken = String(globalThis?.localStorage?.getItem("dockium.appmap.token") || "");
      if (savedToken && !get().appliedToken) {
        set({ tokenInput: savedToken, appliedToken: savedToken });
      }
      syncDataFromAppMap(set, response?.appMap || {}, response?.scanStatus || defaultScanStatus);
    } catch (error) {
      set({ loading: false, error: String(error?.message || "Failed to load app map") });
    }
  },

  startScan: async (authToken) => {
    const token = String((authToken ?? get().appliedToken) || "");
    const response = await window.dockium?.project?.startAppMapScan?.({ authToken: token });
    if (!response?.ok) {
      set({ error: String(response?.error || "Failed to start app map scan") });
      return;
    }
    syncDataFromAppMap(set, response?.appMap || {}, response?.scanStatus || defaultScanStatus);
  },

  refresh: async () => {
    await get().startScan(get().appliedToken);
  },

  applyToken: async () => {
    const token = String(get().tokenInput || "").trim();
    try {
      if (token) {
        globalThis?.localStorage?.setItem("dockium.appmap.token", token);
      } else {
        globalThis?.localStorage?.removeItem("dockium.appmap.token");
      }
    } catch {}
    set({ appliedToken: token });
    await get().startScan(token);
  },

  pollScanStatus: async () => {
    const response = await window.dockium?.project?.getAppMapScanStatus?.();
    if (!response?.ok) {
      return;
    }

    set({ scanStatus: response.scanStatus || defaultScanStatus });
    if (response?.scanStatus?.active === false) {
      await get().hydrate();
    }
  },

  setSearchQuery: (query) => set({ searchQuery: String(query || "") }),
  setMethodFilter: (method) => set({ methodFilter: String(method || "ALL").toUpperCase() }),
  setAuthFilter: (filter) => set({ authFilter: String(filter || "ALL") }),
  setTokenInput: (value) => set({ tokenInput: String(value || "") }),

  toggleFolder: (folderId) => {
    const expanded = get().expandedFolders;
    set({ expandedFolders: { ...expanded, [folderId]: !expanded[folderId] } });
  },

  toggleRouteExpand: (routeId) => {
    const expanded = get().expandedRoutes;
    set({ expandedRoutes: { ...expanded, [routeId]: !expanded[routeId] } });
  },

  selectRoute: (routeId) => {
    const route = get().routes.find((item) => item.id === routeId);
    set({
      selectedRouteId: routeId,
      selectedFilePath: route?.sourceFile || get().selectedFilePath,
    });
  },

  selectFile: (filePath) => {
    const route = get().routes.find((item) => item.sourceFile === filePath);
    set({
      selectedFilePath: filePath,
      fileFilterPath: filePath,
      selectedRouteId: route?.id || get().selectedRouteId,
    });
  },

  clearFileFilter: () => set({ fileFilterPath: "" }),

  updateTestDraft: (routeId, patch) => {
    set((state) => {
      const current = state.routeTests[routeId] || defaultTestDraft(state.routes.find((item) => item.id === routeId));
      return {
        routeTests: {
          ...state.routeTests,
          [routeId]: {
            ...current,
            ...patch,
          },
        },
      };
    });
  },

  toggleTestPanel: (routeId) => {
    set((state) => {
      const route = state.routes.find((item) => item.id === routeId);
      const current = state.routeTests[routeId] || defaultTestDraft(route);
      return {
        routeTests: {
          ...state.routeTests,
          [routeId]: {
            ...current,
            open: !current.open,
          },
        },
      };
    });
  },

  runRouteTest: async (routeId) => {
    const state = get();
    const route = state.routes.find((item) => item.id === routeId);
    if (!route) {
      return;
    }

    const draft = state.routeTests[routeId] || defaultTestDraft(route);
    const headers = parseHeaders(draft.headersText);
    const pathParams = parseParams(draft.paramsText);
    const queryParams = parseParams(draft.queryText);
    const parsedBody = parseJsonLoose(draft.bodyText, draft.bodyText);

    set((inner) => ({
      routeTests: {
        ...inner.routeTests,
        [routeId]: {
          ...draft,
          loading: true,
          error: "",
        },
      },
    }));

    const response = await window.dockium?.project?.testRoute?.({
      route,
      authToken: state.appliedToken,
      headers,
      pathParams,
      queryParams,
      body: parsedBody,
      method: route.method,
    });

    set((inner) => ({
      routeTests: {
        ...inner.routeTests,
        [routeId]: {
          ...draft,
          loading: false,
          error: response?.ok ? "" : String(response?.error || "Route test failed"),
          result: response?.ok ? response.result : null,
        },
      },
    }));
  },

  runAuthRouteChecks: async () => {
    const state = get();
    const routes = Array.isArray(state.routes) ? state.routes : [];
    const registerRouteCandidatesRaw = pickAuthRouteCandidates(routes, "register");
    const loginRouteCandidates = pickAuthRouteCandidates(routes, "login");
    const registerFallbackCandidates = buildRegisterFallbackCandidates(routes, loginRouteCandidates);
    const registerRouteCandidates = dedupeRouteCandidates([
      ...registerRouteCandidatesRaw,
      ...registerFallbackCandidates,
    ]).slice(0, MAX_AUTH_ROUTE_CANDIDATES + 4);
    const protectedRoute = routes
      .filter((route) => isProtectedRoute(route))
      .sort((a, b) => protectedRouteScore(a) - protectedRouteScore(b))[0] || null;
    const securityQuestionRoute = routes.find((route) => {
      const method = String(route?.method || "GET").toUpperCase();
      const pathValue = String(route?.path || route?.fullPath || "").toLowerCase();
      return method === "GET" && /security[-_]?question/.test(pathValue);
    }) || null;
    const uiAuthCandidates = routes
      .filter((route) => isUiAuthPageRoute(route))
      .slice(0, 6);

    if (registerRouteCandidates.length === 0 && loginRouteCandidates.length === 0) {
      set({
        authRouteChecks: {
          loading: false,
          error: "No login/register POST routes discovered in current app map.",
          lastRunAt: new Date().toISOString(),
          results: [],
          workflow: null,
        },
      });
      return;
    }

    set({
      authRouteChecks: {
        loading: true,
        error: "",
        lastRunAt: null,
        results: [],
        workflow: null,
      },
    });

    const configResponse = await window.dockium?.project?.getConfig?.();
    const config = configResponse?.ok ? (configResponse.config || {}) : {};
    const credentialPool = credentialCandidates(config);
    const uiHints = {
      loginFields: [],
      registerFields: [],
      scannedRoutes: [],
    };

    for (const uiRoute of uiAuthCandidates) {
      const uiProbe = await window.dockium?.project?.testRoute?.({
        route: uiRoute,
        authToken: "",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        pathParams: [],
        queryParams: [],
        body: null,
        method: "GET",
      });

      const bodyPreview = String(uiProbe?.result?.liveResponse?.bodyPreview || "");
      const fields = extractUiInputFieldHints(bodyPreview);
      if (fields.length === 0) {
        continue;
      }

      const pathValue = String(uiRoute?.path || uiRoute?.fullPath || "").toLowerCase();
      if (/(login|signin)/.test(pathValue)) {
        uiHints.loginFields = mergeFieldHints(uiHints.loginFields, fields);
      }
      if (/(register|signup)/.test(pathValue)) {
        uiHints.registerFields = mergeFieldHints(uiHints.registerFields, fields);
      }
      uiHints.scannedRoutes.push(uiRoute.path || uiRoute.fullPath || "/");
    }

    let discoveredSecuritySeed = null;
    if (securityQuestionRoute) {
      const securityProbe = await window.dockium?.project?.testRoute?.({
        route: securityQuestionRoute,
        authToken: "",
        headers: {},
        pathParams: [],
        queryParams: [],
        body: null,
        method: securityQuestionRoute.method,
      });
      discoveredSecuritySeed = extractSecurityQuestionSeed(securityProbe?.result || null);
    }
    const workflow = {
      register: {
        attempted: registerRouteCandidates.length > 0,
        ok: false,
        statusCode: 0,
        path: registerRouteCandidates[0]?.path || "",
        detail: "",
      },
      login: {
        attempted: loginRouteCandidates.length > 0,
        ok: false,
        statusCode: 0,
        path: loginRouteCandidates[0]?.path || "",
        detail: "",
      },
      protected: {
        attempted: false,
        ok: false,
        statusCode: 0,
        path: protectedRoute?.path || "",
        detail: "",
      },
      authArtifact: {
        token: false,
        cookie: false,
      },
      aiPayloadHelp: {
        attempted: false,
        used: false,
        status: 0,
        detail: "",
      },
      postAuthSweep: {
        attempted: false,
        tested: 0,
        passed: 0,
        failed: 0,
        pageRoutes: 0,
        apiRoutes: 0,
        detail: "",
      },
      uiAssist: {
        attempted: uiAuthCandidates.length > 0,
        pagesTested: uiHints.scannedRoutes.length,
        loginFields: uiHints.loginFields,
        registerFields: uiHints.registerFields,
        detail: uiHints.scannedRoutes.length > 0
          ? `UI auth fields extracted from ${uiHints.scannedRoutes.length} page(s).`
          : "No UI auth fields extracted from discovered pages.",
      },
    };

    const results = [];
    let createdCredential = null;
    let persistedAuthArtifact = "";
    const registerCredentialCandidates = [];

    function addRegisterCredentialCandidate(seed, source = "register-derived") {
      const email = normalizeEmailLike(String(seed?.email || "").trim());
      const password = String(seed?.password || "").trim();
      if (!email || !password) {
        return;
      }

      const exists = registerCredentialCandidates.some((entry) => entry.email === email && entry.password === password);
      if (exists) {
        return;
      }

      registerCredentialCandidates.push({
        email,
        password,
        source,
      });
    }

    function authOutcomeRank(outcome) {
      if (outcome?.authSuccess) {
        return 5;
      }
      const statusCode = Number(outcome?.statusCode || 0);
      if (statusCode === 409) {
        return 4;
      }
      if (statusCode >= 200 && statusCode < 300) {
        return 3;
      }
      if (statusCode >= 400 && statusCode < 500) {
        return 2;
      }
      if (statusCode > 0) {
        return 1;
      }
      return 0;
    }

    function seedPriority(seed) {
      const source = String(seed?.source || "").toLowerCase();
      if (source.startsWith("register-created")) return 0;
      if (source.startsWith("register-http-success")) return 1;
      if (source.startsWith("register-attempt")) return 2;
      if (source.includes("known-juice-shop-admin")) return 3;
      if (source.includes("known-juice-shop")) return 4;
      if (source.includes("admin-user")) return 5;
      if (source.includes("test-user")) return 6;
      if (source.includes("fallback")) return 7;
      return 8;
    }

    async function runAuthVariants(route, kind, seed) {
      if (!route) {
        return {
          ok: false,
          authSuccess: false,
          statusCode: 0,
          error: "Route not found",
          pickedPayload: null,
          triedStatuses: [],
          credentialSource: seed?.source || "unknown",
          payloadSource: "none",
          routeResult: null,
        };
      }

      function outcomeRank(success, statusCode) {
        if (success) {
          return 4;
        }
        if (statusCode >= 200 && statusCode < 300) {
          return 3;
        }
        if (statusCode === 409) {
          return 3;
        }
        if (statusCode >= 400 && statusCode < 500) {
          return 2;
        }
        if (statusCode >= 500) {
          return 1;
        }
        return 0;
      }

      const variants = authPayloadVariants(route, kind, seed, uiHints);
      let pickedResponse = null;
      let pickedPayload = null;
      let pickedStatusCode = 0;
      let pickedSource = "heuristic";
      let pickedAuthSuccess = false;
      let pickedRank = 0;
      const triedStatuses = [];
      const seenPayloads = new Set();
      let responsePreviewForAi = "";

      function shouldEscalateToAiSoon() {
        if (triedStatuses.length < 3) {
          return false;
        }

        const recent = triedStatuses.slice(-3).filter((code) => Number(code || 0) > 0);
        if (recent.length < 3) {
          return false;
        }

        const repeatedStatus = new Set(recent).size === 1;
        const allUnauthorized = recent.every((code) => code === 401 || code === 403);
        const allServerErrors = recent.every((code) => code >= 500);
        return repeatedStatus || allUnauthorized || allServerErrors;
      }

      async function testVariantPayload(variant, source = "heuristic") {
        const signature = JSON.stringify(variant || {});
        if (seenPayloads.has(signature)) {
          return { skipped: true, success: false };
        }
        seenPayloads.add(signature);

        const encodings = ["json", "form"];
        for (const encoding of encodings) {
          const response = await window.dockium?.project?.testRoute?.({
            route,
            authToken: "",
            headers: {},
            pathParams: [],
            queryParams: [],
            body: variant,
            bodyEncoding: encoding,
            method: route.method,
          });

          const statusCode = Number(response?.result?.liveResponse?.statusCode || 0);
          const statusLooksSuccessful = kind === "register"
            ? Boolean(response?.ok && ((statusCode >= 200 && statusCode < 300) || statusCode === 409))
            : Boolean(response?.ok && statusCode >= 200 && statusCode < 300);
          const responseMissingIdentity = kind === "register"
            ? registerResponseMissingIdentity(response?.result)
            : false;
          const success = statusLooksSuccessful && !responseMissingIdentity;
          const currentRank = outcomeRank(success, statusCode);

          triedStatuses.push(statusCode || 0);

          const bodyPreview = clipText(String(response?.result?.liveResponse?.bodyPreview || ""), 160);
          if (!responsePreviewForAi && bodyPreview && !success) {
            responsePreviewForAi = bodyPreview;
          }
          if (!responsePreviewForAi && responseMissingIdentity) {
            responsePreviewForAi = "Register response is missing a usable email/username identity.";
          }

          if (!pickedResponse || currentRank > pickedRank || (currentRank === pickedRank && statusCode > pickedStatusCode)) {
            pickedResponse = response;
            pickedPayload = variant;
            pickedStatusCode = statusCode;
            pickedSource = `${source}:${encoding}`;
            pickedAuthSuccess = success;
            pickedRank = currentRank;
          }

          if (success) {
            return { skipped: false, success: true };
          }
        }

        return { skipped: false, success: false };
      }

      for (const variant of variants) {
        const tried = await testVariantPayload(variant, "heuristic");
        if (tried.success) {
          break;
        }
        if (shouldEscalateToAiSoon()) {
          break;
        }
      }

      if (!pickedAuthSuccess) {
        const aiSuggestion = await suggestAiAuthPayloads(route, kind, seed, triedStatuses, responsePreviewForAi);
        workflow.aiPayloadHelp.attempted = workflow.aiPayloadHelp.attempted || Boolean(aiSuggestion.attempted);
        workflow.aiPayloadHelp.status = Number(aiSuggestion.status || workflow.aiPayloadHelp.status || 0);
        workflow.aiPayloadHelp.detail = aiSuggestion.detail || workflow.aiPayloadHelp.detail;

        if (Array.isArray(aiSuggestion.payloads) && aiSuggestion.payloads.length > 0) {
          workflow.aiPayloadHelp.used = true;
          for (const payload of aiSuggestion.payloads) {
            const tried = await testVariantPayload(payload, "ai");
            if (tried.success) {
              break;
            }
          }
        }
      }

      const previewBody = clipText(String(pickedResponse?.result?.liveResponse?.bodyPreview || ""), 280);

      return {
        ok: Boolean(pickedResponse?.ok),
        authSuccess: pickedAuthSuccess,
        statusCode: pickedStatusCode,
        error: pickedResponse?.ok ? "" : String(pickedResponse?.error || "Route test failed"),
        pickedPayload,
        triedStatuses,
        responsePreview: previewBody,
        credentialSource: seed?.source || "unknown",
        payloadSource: pickedSource,
        routeResult: pickedResponse?.result || null,
      };
    }

    if (registerRouteCandidates.length > 0) {
      let selectedRegisterRoute = registerRouteCandidates[0];
      let selectedRegisterOutcome = null;

      for (const candidateRoute of registerRouteCandidates) {
        const registerOutcome = await runAuthVariants(candidateRoute, "register", {
          ...(credentialPool[0] || {}),
          ...(discoveredSecuritySeed || {}),
        });
        const registerSuccess = Boolean(registerOutcome.authSuccess);
        const httpAccepted = registerOutcome.statusCode >= 200
          && (registerOutcome.statusCode < 300 || registerOutcome.statusCode === 409);
        const attemptedEmail = normalizeEmailLike(String(
          registerOutcome.pickedPayload?.email
          || registerOutcome.pickedPayload?.username
          || registerOutcome.pickedPayload?.login
          || ""
        ).trim());
        const attemptedPassword = String(registerOutcome.pickedPayload?.password || "").trim();

        if (httpAccepted && attemptedEmail && attemptedPassword) {
          addRegisterCredentialCandidate(
            { email: attemptedEmail, password: attemptedPassword },
            `register-http-success:${candidateRoute.path || candidateRoute.fullPath || "unknown"}`,
          );
        }

        results.push({
          routeId: candidateRoute.id,
          kind: "register",
          method: candidateRoute.method,
          path: candidateRoute.path,
          statusCode: registerOutcome.statusCode,
          ok: registerSuccess,
          error: registerOutcome.error || (!registerSuccess ? `HTTP ${registerOutcome.statusCode || 0}` : ""),
          credentialSource: registerOutcome.credentialSource,
          payloadSource: registerOutcome.payloadSource,
          payloadKeys: Object.keys(registerOutcome.pickedPayload || {}),
          triedStatuses: registerOutcome.triedStatuses,
          responsePreview: registerOutcome.responsePreview,
        });

        if (!selectedRegisterOutcome) {
          selectedRegisterRoute = candidateRoute;
          selectedRegisterOutcome = registerOutcome;
        }

        if (registerSuccess) {
          selectedRegisterRoute = candidateRoute;
          selectedRegisterOutcome = registerOutcome;
          break;
        }

        const candidateRank = authOutcomeRank(registerOutcome);
        const selectedRank = authOutcomeRank(selectedRegisterOutcome);
        const selectedStatus = Number(selectedRegisterOutcome?.statusCode || 0);
        if (candidateRank > selectedRank || (candidateRank === selectedRank && registerOutcome.statusCode > selectedStatus)) {
          selectedRegisterRoute = candidateRoute;
          selectedRegisterOutcome = registerOutcome;
        }
      }

      const registerOutcome = selectedRegisterOutcome || {
        authSuccess: false,
        statusCode: 0,
        error: "Register route test failed",
        pickedPayload: null,
        credentialSource: "unknown",
        payloadSource: "heuristic",
        triedStatuses: [],
        responsePreview: "",
      };
      const registerSuccess = Boolean(registerOutcome.authSuccess);

      workflow.register.path = selectedRegisterRoute?.path || workflow.register.path;
      workflow.register.ok = registerSuccess;
      workflow.register.statusCode = registerOutcome.statusCode;
      workflow.register.detail = registerOutcome.error || registerOutcome.responsePreview || "";

      if (registerSuccess) {
        createdCredential = {
          email: normalizeEmailLike(String(
            registerOutcome.pickedPayload?.email
            || registerOutcome.pickedPayload?.username
            || credentialPool[0]?.email
            || ""
          ).trim(), credentialPool[0]?.email || "user@example.com"),
          password: String(registerOutcome.pickedPayload?.password || credentialPool[0]?.password || "").trim(),
          source: registerOutcome.statusCode === 409 ? "register-existing" : "register-created",
        };
      } else if (registerCredentialCandidates.length > 0) {
        createdCredential = {
          ...registerCredentialCandidates[0],
          source: registerCredentialCandidates[0].source || "register-http-success",
        };
      } else if (registerOutcome?.pickedPayload) {
        const attemptedEmail = normalizeEmailLike(String(
          registerOutcome.pickedPayload?.email
          || registerOutcome.pickedPayload?.username
          || registerOutcome.pickedPayload?.login
          || ""
        ).trim());
        const attemptedPassword = String(registerOutcome.pickedPayload?.password || "").trim();
        if (attemptedEmail && attemptedPassword) {
          createdCredential = {
            email: attemptedEmail,
            password: attemptedPassword,
            source: "register-attempt-payload",
          };
        }
      }
    }

    let loginArtifact = { token: "", cookie: "" };
    if (loginRouteCandidates.length > 0) {
      const loginSeeds = [];
      const addLoginSeed = (candidate) => {
        const email = normalizeEmailLike(String(candidate?.email || "").trim());
        const password = String(candidate?.password || "").trim();
        if (!email || !password) {
          return;
        }
        const exists = loginSeeds.some((seed) => seed.email === email && seed.password === password);
        if (!exists) {
          loginSeeds.push({ ...candidate, email, password });
        }
      };

      if (createdCredential?.email && createdCredential?.password) {
        addLoginSeed(createdCredential);
      }

      registerCredentialCandidates.forEach((candidate) => addLoginSeed(candidate));

      const prioritizedCredentialPool = [...credentialPool].sort((a, b) => seedPriority(a) - seedPriority(b));
      prioritizedCredentialPool.forEach((candidate) => addLoginSeed(candidate));

      const boundedLoginSeeds = loginSeeds.slice(0, MAX_LOGIN_SEED_CANDIDATES);

      let selectedLoginRoute = loginRouteCandidates[0];
      let selectedLoginOutcome = null;

      for (const loginRoute of loginRouteCandidates) {
        let loginOutcome = null;
        const combinedStatuses = [];

        for (const loginSeed of boundedLoginSeeds) {
          const attempt = await runAuthVariants(loginRoute, "login", loginSeed);
          combinedStatuses.push(...attempt.triedStatuses);

          if (!loginOutcome) {
            loginOutcome = attempt;
          }

          const attemptOk = attempt.statusCode >= 200 && attempt.statusCode < 300;
          if (attemptOk) {
            loginOutcome = {
              ...attempt,
              triedStatuses: combinedStatuses,
            };
            break;
          }

          if ((loginOutcome.statusCode || 0) === 0 && (attempt.statusCode || 0) > 0) {
            loginOutcome = {
              ...attempt,
              triedStatuses: combinedStatuses,
            };
          }
        }

        loginOutcome = loginOutcome || {
          ok: false,
          authSuccess: false,
          statusCode: 0,
          error: "Login route test failed",
          pickedPayload: null,
          triedStatuses: combinedStatuses,
          credentialSource: "unknown",
          routeResult: null,
        };

        const loginSuccess = Boolean(loginOutcome.authSuccess);

        results.push({
          routeId: loginRoute.id,
          kind: "login",
          method: loginRoute.method,
          path: loginRoute.path,
          statusCode: loginOutcome.statusCode,
          ok: loginSuccess,
          error: loginOutcome.error || (!loginSuccess ? `HTTP ${loginOutcome.statusCode || 0}` : ""),
          credentialSource: loginOutcome.credentialSource,
          payloadSource: loginOutcome.payloadSource,
          payloadKeys: Object.keys(loginOutcome.pickedPayload || {}),
          triedStatuses: loginOutcome.triedStatuses,
          responsePreview: loginOutcome.responsePreview,
        });

        if (!selectedLoginOutcome) {
          selectedLoginRoute = loginRoute;
          selectedLoginOutcome = loginOutcome;
        }

        if (loginSuccess) {
          selectedLoginRoute = loginRoute;
          selectedLoginOutcome = loginOutcome;
          break;
        }

        if ((selectedLoginOutcome?.statusCode || 0) === 0 && (loginOutcome.statusCode || 0) > 0) {
          selectedLoginRoute = loginRoute;
          selectedLoginOutcome = loginOutcome;
        }
      }

      const loginOutcome = selectedLoginOutcome || {
        ok: false,
        authSuccess: false,
        statusCode: 0,
        error: "Login route test failed",
        pickedPayload: null,
        triedStatuses: [],
        credentialSource: "unknown",
        routeResult: null,
      };

      const loginSuccess = Boolean(loginOutcome.authSuccess);
      const artifact = extractAuthArtifact(loginOutcome.routeResult);
      loginArtifact = artifact;

      workflow.login.path = selectedLoginRoute?.path || workflow.login.path;
      workflow.login.ok = loginSuccess;
      workflow.login.statusCode = loginOutcome.statusCode;
      workflow.login.detail = loginOutcome.error || loginOutcome.responsePreview || "";
      workflow.authArtifact.token = Boolean(artifact.token);
      workflow.authArtifact.cookie = Boolean(artifact.cookie);
      persistedAuthArtifact = artifact.token || artifact.cookie || "";
    }

    if (protectedRoute && (loginArtifact.token || loginArtifact.cookie)) {
      workflow.protected.attempted = true;
      const authHeaders = {
        ...(loginArtifact.cookie ? { Cookie: loginArtifact.cookie } : {}),
        ...(loginArtifact.token
          ? {
              Authorization: /^bearer\s+/i.test(loginArtifact.token)
                ? loginArtifact.token
                : `Bearer ${loginArtifact.token}`,
            }
          : {}),
      };
      const response = await window.dockium?.project?.testRoute?.({
        route: protectedRoute,
        authToken: "",
        headers: authHeaders,
        pathParams: [],
        queryParams: [],
        body: null,
        method: protectedRoute.method,
      });

      const statusCode = Number(response?.result?.liveResponse?.statusCode || 0);
      const protectedOk = Boolean(response?.ok && statusCode >= 200 && statusCode < 400);
      workflow.protected.ok = protectedOk;
      workflow.protected.statusCode = statusCode;
      workflow.protected.detail = response?.ok ? "" : String(response?.error || "Route test failed");

      results.push({
        routeId: protectedRoute.id,
        kind: "protected",
        method: protectedRoute.method,
        path: protectedRoute.path,
        statusCode,
        ok: protectedOk,
        error: response?.ok ? "" : String(response?.error || "Route test failed"),
        credentialSource: loginArtifact.cookie ? "session-cookie" : "bearer-token",
        payloadKeys: [],
        triedStatuses: [statusCode],
      });
    }

    if (persistedAuthArtifact) {
      const authHeaders = {
        ...(loginArtifact.cookie ? { Cookie: loginArtifact.cookie } : {}),
        ...(loginArtifact.token
          ? {
              Authorization: /^bearer\s+/i.test(loginArtifact.token)
                ? loginArtifact.token
                : `Bearer ${loginArtifact.token}`,
            }
          : {}),
      };

      const sweepCandidates = routes
        .filter((route) => {
          const method = String(route?.method || "GET").toUpperCase();
          return method === "GET" || method === "HEAD";
        })
        .slice(0, MAX_POST_AUTH_SWEEP_ROUTES);

      let tested = 0;
      let passed = 0;
      let failed = 0;
      let pageRoutes = 0;
      let apiRoutes = 0;
      const failedSamples = [];

      for (const route of sweepCandidates) {
        const pathValue = String(route?.path || route?.fullPath || "").toLowerCase();
        if (pathValue.startsWith("/api/") || pathValue.startsWith("/rest/") || pathValue === "/api" || pathValue === "/rest") {
          apiRoutes += 1;
        } else {
          pageRoutes += 1;
        }

        const pathParams = Array.isArray(route?.request?.pathParams)
          ? route.request.pathParams.map((param) => ({
              name: String(param?.name || "id"),
              value: String(param?.value || "1"),
            }))
          : [];
        const queryParams = Array.isArray(route?.request?.queryParams)
          ? route.request.queryParams
            .slice(0, 5)
            .map((param) => ({
              name: String(param?.name || "q"),
              value: "sample",
            }))
          : [];

        const response = await window.dockium?.project?.testRoute?.({
          route,
          authToken: "",
          headers: authHeaders,
          pathParams,
          queryParams,
          body: null,
          method: route.method,
        });

        const statusCode = Number(response?.result?.liveResponse?.statusCode || 0);
        tested += 1;
        const ok = Boolean(response?.ok && statusCode > 0 && statusCode < 400);
        if (ok) {
          passed += 1;
        } else {
          failed += 1;
          if (failedSamples.length < 4) {
            failedSamples.push(`${route?.method || "GET"} ${route?.path || "/"} -> ${statusCode || 0}`);
          }
        }
      }

      workflow.postAuthSweep = {
        attempted: tested > 0,
        tested,
        passed,
        failed,
        pageRoutes,
        apiRoutes,
        detail: failedSamples.length > 0
          ? `Sample failures: ${failedSamples.join(" | ")}`
          : "All checked routes accepted authenticated session.",
      };

      results.push({
        routeId: "post-auth-sweep",
        kind: "post-auth-sweep",
        method: "GET/HEAD",
        path: `${tested} routes`,
        statusCode: failed > 0 ? 207 : 200,
        ok: failed === 0,
        error: failed > 0 ? `${failed}/${tested} routes failed` : "",
        credentialSource: loginArtifact.cookie ? "session-cookie" : "bearer-token",
        payloadKeys: [],
        triedStatuses: [passed, failed],
        responsePreview: workflow.postAuthSweep.detail,
      });
    }

    const nextState = {
      authRouteChecks: {
        loading: false,
        error: "",
        lastRunAt: new Date().toISOString(),
        results,
        workflow,
      },
    };

    if (persistedAuthArtifact) {
      nextState.appliedToken = persistedAuthArtifact;
      nextState.tokenInput = persistedAuthArtifact;
    }

    set(nextState);
  },
}));
