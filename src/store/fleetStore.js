import { create } from "zustand";

function nowClock() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function sanitizeText(value) {
  const raw = String(value ?? "");
  const noAnsi = raw.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
  const noControl = noAnsi.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return noControl.replace(/\s+/g, " ").trim();
}

function normalizePreviewUrl(value, fallback = "about:blank") {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return fallback;
  }

  // Keep data URLs raw; sanitizing can alter the base64 payload.
  if (raw.startsWith("data:image/")) {
    return raw;
  }

  const text = sanitizeText(raw);
  if (!text) {
    return fallback;
  }
  if (text.startsWith("file://") || text.startsWith("http")) {
    return text;
  }
  return fallback;
}

function logLine(role, message) {
  return `${nowClock()} [${sanitizeText(role || "SYSTEM")}] ${sanitizeText(message || "")}`;
}

function toSession(id, value) {
  const roleMap = {
    legitUser: "LEGIT USER",
    attacker: "ATTACKER",
    admin: "ADMIN MAPPER",
    fieldFuzzer: "FIELD FUZZER",
    observerOne: "OBSERVER 1",
    observerTwo: "OBSERVER 2",
  };

  return {
    id,
    role: roleMap[id] || id.toUpperCase(),
    status: String(value?.status || "IDLE").toUpperCase(),
    current: sanitizeText(value?.context || "--"),
    session: value?.status === "RUNNING" ? "active" : "--",
    requestsCount: Number(value?.requestCount || 0),
    findingsCount: Number(value?.findingsCount || 0),
    surfacesFound: 0,
    payloadStatus: "--",
    last: sanitizeText(value?.lastEvent || (value?.context ? `Navigated ${value.context}` : "--")),
    previewUrl: normalizePreviewUrl(value?.screenshot, normalizePreviewUrl(value?.context, "about:blank")),
    miniLog: [sanitizeText(value?.lastEvent || value?.context || "No active run")],
    requests: [],
  };
}

export const useFleetStore = create((set, get) => ({
  fleetStatus: "IDLE",
  browserEngine: "Chromium",
  headless: "ON",
  useProxy: false,
  windowCount: 4,
  roleOptions: [
    { id: "legitUser", label: "Legit User", enabled: true },
    { id: "admin", label: "Admin Mapper", enabled: true },
    { id: "attacker", label: "Attacker", enabled: true },
    { id: "fieldFuzzer", label: "Field Fuzzer", enabled: true },
    { id: "observerOne", label: "Observer 1", enabled: false },
    { id: "observerTwo", label: "Observer 2", enabled: false },
  ],
  sessions: [],
  selectedSessionId: null,
  startError: "",
  authCheck: {
    loading: false,
    status: "UNKNOWN",
    detail: "Not checked",
    route: "",
    checkedAt: "",
  },
  activityLog: [logLine("SYSTEM", "Fleet idle")],

  checkAuthState: async () => {
    set((state) => ({
      authCheck: {
        ...state.authCheck,
        loading: true,
      },
    }));

    try {
      const appMap = await window.dockium?.project?.getAppMap?.();
      const routes = Array.isArray(appMap?.routeTree) ? appMap.routeTree : [];

      const candidate = routes.find((route) => {
        const method = String(route?.method || "GET").toUpperCase();
        const pathValue = String(route?.path || route?.fullPath || "").toLowerCase();
        if (method !== "GET") {
          return false;
        }
        if (route?.authRequired) {
          return true;
        }
        return /\/me|\/whoami|\/profile|\/account/.test(pathValue);
      }) || null;

      if (!candidate) {
        set((state) => ({
          authCheck: {
            ...state.authCheck,
            loading: false,
            status: "UNKNOWN",
            detail: "No protected route found for auth check",
            route: "",
            checkedAt: new Date().toISOString(),
          },
          activityLog: [logLine("SYSTEM", "Fleet auth check: no protected route available"), ...state.activityLog].slice(0, 80),
        }));
        return;
      }

      const tested = await window.dockium?.project?.testRoute?.({
        route: candidate,
        authToken: "",
        headers: {},
        pathParams: [],
        queryParams: [],
        body: null,
        method: candidate.method,
      });

      const statusCode = Number(tested?.result?.liveResponse?.statusCode || 0);
      const loginState = (statusCode === 401 || statusCode === 403)
        ? "NOT_LOGGED_IN"
        : statusCode > 0 && statusCode < 400
          ? "LOGGED_IN_OR_PUBLIC"
          : "UNKNOWN";

      set((state) => ({
        authCheck: {
          loading: false,
          status: loginState,
          detail: `Auth probe ${String(candidate?.method || "GET").toUpperCase()} ${candidate?.path || candidate?.fullPath || "/"} -> ${statusCode || 0}`,
          route: String(candidate?.path || candidate?.fullPath || ""),
          checkedAt: new Date().toISOString(),
        },
        activityLog: [logLine("SYSTEM", `Fleet auth check: ${loginState} (${statusCode || 0})`), ...state.activityLog].slice(0, 80),
      }));
    } catch (error) {
      set((state) => ({
        authCheck: {
          loading: false,
          status: "UNKNOWN",
          detail: `Auth probe failed: ${sanitizeText(error?.message || "unknown")}`,
          route: "",
          checkedAt: new Date().toISOString(),
        },
        activityLog: [logLine("SYSTEM", `Fleet auth check failed: ${error?.message || "unknown"}`), ...state.activityLog].slice(0, 80),
      }));
    }
  },

  applyFleetSnapshot: (statusMap = {}) => {
    const entries = Object.entries(statusMap || {});
    if (entries.length === 0) {
      set({ sessions: [], selectedSessionId: null, fleetStatus: "IDLE" });
      return;
    }

    const sessions = entries.map(([id, value]) => toSession(id, value));
    const running = sessions.some((session) => ["RUNNING", "STARTING", "COMPLETE"].includes(session.status));

    set((state) => ({
      sessions,
      selectedSessionId: sessions.some((item) => item.id === state.selectedSessionId)
        ? state.selectedSessionId
        : sessions[0]?.id || null,
      fleetStatus: running ? "RUNNING" : "IDLE",
    }));
  },

  applyFleetEvent: (message) => {
    const event = message?.data || message || {};
    const sessionId = event.sessionId;
    if (!sessionId) {
      return;
    }

    if (sessionId === "fleet") {
      const fleetLine = sanitizeText(event?.data || event?.event || "fleet");
      set((state) => ({
        fleetStatus: event.event === "initialized" ? "RUNNING" : state.fleetStatus,
        startError: "",
        activityLog: [logLine("SYSTEM", fleetLine), ...state.activityLog].slice(0, 80),
      }));
      return;
    }

    if (event.event === "screenshot") {
      const screenshotUrl = normalizePreviewUrl(event.data);
      if (!screenshotUrl || screenshotUrl === "about:blank") {
        return;
      }

      set((state) => {
        const existing = state.sessions.find((session) => session.id === sessionId);
        const seedSession = existing || {
          id: sessionId,
          role: sanitizeText(event.role || sessionId).toUpperCase(),
          status: "RUNNING",
          current: "--",
          session: "active",
          requestsCount: 0,
          findingsCount: 0,
          surfacesFound: 0,
          payloadStatus: "--",
          last: "Live preview updated",
          previewUrl: screenshotUrl,
          miniLog: ["Live preview updated"],
          requests: [],
        };

        const updatedSession = {
          ...seedSession,
          status: seedSession.status === "IDLE" ? "RUNNING" : seedSession.status,
          previewUrl: screenshotUrl,
        };

        const nextSessions = existing
          ? state.sessions.map((session) => (session.id === sessionId ? updatedSession : session))
          : [updatedSession, ...state.sessions];

        return {
          sessions: nextSessions,
          selectedSessionId: state.selectedSessionId || sessionId,
          fleetStatus: "RUNNING",
          startError: "",
        };
      });
      return;
    }

    const line = typeof event.data === "string"
      ? event.data
      : event.event === "request"
        ? `${event.data?.method || "GET"} ${event.data?.path || "/"}`
        : `${event.event || "event"}`;
    const safeLine = sanitizeText(line);

    const incomingRequest = event.event === "request" && event.data
      ? {
          id: event.data.id || `req-${Date.now()}-${Math.random()}`,
          method: sanitizeText(event.data.method || "GET") || "GET",
          host: sanitizeText(event.data.host || "--") || "--",
          path: sanitizeText(event.data.path || "/") || "/",
          status: sanitizeText(event.data.status || "--") || "--",
          timeMs: Number(event.data.timeMs || 0),
        }
      : null;

    const screenshotUrl = event.event === "screenshot"
      ? normalizePreviewUrl(event.data)
      : null;

    set((state) => {
      const existing = state.sessions.find((session) => session.id === sessionId);
      const seedSession = existing || {
        id: sessionId,
        role: sanitizeText(event.role || sessionId).toUpperCase(),
        status: "STARTING",
        current: "--",
        session: "active",
        requestsCount: 0,
        findingsCount: 0,
        surfacesFound: 0,
        payloadStatus: "--",
        last: "--",
        previewUrl: "about:blank",
        miniLog: [],
        requests: [],
      };

      const nextRequests = incomingRequest
        ? [...seedSession.requests, incomingRequest].slice(-400)
        : seedSession.requests;

      const updatedSession = {
        ...seedSession,
        status: event.event === "error"
          ? "ERROR"
          : event.event === "complete"
            ? "COMPLETE"
            : seedSession.status === "IDLE"
              ? "RUNNING"
              : seedSession.status,
        session: "active",
        last: safeLine,
        current: sanitizeText(event?.context || seedSession.current || "--"),
        previewUrl: screenshotUrl || seedSession.previewUrl,
        requestsCount: incomingRequest ? nextRequests.length : seedSession.requestsCount,
        requests: nextRequests,
        miniLog: [safeLine, ...seedSession.miniLog].slice(0, 8),
      };

      const nextSessions = existing
        ? state.sessions.map((session) => (session.id === sessionId ? updatedSession : session))
        : [updatedSession, ...state.sessions];

      return {
        sessions: nextSessions,
        selectedSessionId: state.selectedSessionId || sessionId,
        fleetStatus: "RUNNING",
        startError: "",
        activityLog: [logLine(event.role || sessionId, safeLine), ...state.activityLog].slice(0, 80),
      };
    });
  },

  hydrate: async () => {
    const result = await window.dockium?.fleet?.getStatus?.();
    get().applyFleetSnapshot(result?.status || {});
  },

  setBrowserEngine: (value) => set({ browserEngine: value }),
  setHeadless: (value) => set({ headless: value }),
  setUseProxy: async (value) => {
    const enabled = value === true;
    set({ useProxy: enabled });

    if (!enabled) {
      return;
    }

    const proxyStatus = await window.dockium?.proxy?.getStatus?.();
    if (!proxyStatus?.status?.running) {
      await window.dockium?.proxy?.start?.();
    }
  },
  setWindowCount: (value) => set({ windowCount: Math.max(1, Math.min(12, Number(value || 6))) }),
  toggleRoleOption: (roleId) => {
    set((state) => ({
      roleOptions: state.roleOptions.map((role) =>
        role.id === roleId ? { ...role, enabled: !role.enabled } : role,
      ),
    }));
  },
  selectSession: (id) => set({ selectedSessionId: id }),

  startFleet: async () => {
    await get().checkAuthState();

    const selectedRoles = get().roleOptions.filter((role) => role.enabled).map((role) => role.id);

    const payload = {
      browserEngine: String(get().browserEngine || "Chromium").toLowerCase(),
      headless: true,
      windowCount: Number(get().windowCount || 6),
      roles: selectedRoles,
      useProxy: get().useProxy === true,
    };

    if (payload.useProxy) {
      const proxyStatus = await window.dockium?.proxy?.getStatus?.();
      if (!proxyStatus?.status?.running) {
        await window.dockium?.proxy?.start?.();
      }
    }

    const started = await window.dockium?.fleet?.start?.(payload);
    get().applyFleetSnapshot(started?.status || {});

    set((state) => ({
      fleetStatus: started?.ok ? "RUNNING" : state.fleetStatus,
      startError: started?.ok ? "" : sanitizeText(started?.error || "Fleet start failed"),
      activityLog: [
        logLine(
          "SYSTEM",
          started?.ok
            ? `Fleet started (${payload.roles.length || payload.windowCount} roles)`
            : `Fleet start failed: ${started?.error || "unknown"}`,
        ),
        ...state.activityLog,
      ].slice(0, 80),
    }));
  },

  stopFleet: async () => {
    await window.dockium?.fleet?.stop?.();
    await get().hydrate();

    set((state) => ({
      fleetStatus: "IDLE",
      startError: "",
      activityLog: [logLine("SYSTEM", "Fleet stopped"), ...state.activityLog].slice(0, 60),
    }));
  },

  selectedSession: () => {
    const { sessions: allSessions, selectedSessionId } = get();
    return allSessions.find((session) => session.id === selectedSessionId) ?? allSessions[0] ?? null;
  },
}));
