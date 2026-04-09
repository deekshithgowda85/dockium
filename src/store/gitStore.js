import { create } from "zustand";

const defaultRules = {
  blockCritical: true,
  blockHigh: true,
  blockMedium: false,
  blockSecrets: true,
  blockTestFailures: true,
  blockUnscannedRoutes: false,
  threshold: 1,
};

function severityCounts(findings = []) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of Array.isArray(findings) ? findings : []) {
    const key = String(finding?.severity || "info").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, key)) {
      counts[key] += 1;
    } else {
      counts.info += 1;
    }
  }
  return counts;
}

function normalizeDuration(item = {}) {
  if (item.duration) {
    return String(item.duration);
  }
  const durationMs = Number(item.durationMs || 0);
  if (!durationMs) {
    return "-";
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function toResultStatus(item = {}) {
  if (item.result) {
    return String(item.result).toUpperCase();
  }
  if (item.blocked === true || item.allowed === false) {
    return "BLOCKED";
  }
  return "FORWARDED";
}

function mergeHistoryRecords(primary = [], secondary = []) {
  const out = [];
  const seen = new Set();
  for (const entry of [...primary, ...secondary]) {
    const key = `${entry?.timestamp || ""}|${entry?.commitSha || entry?.commit || ""}|${entry?.result || ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(entry);
  }
  return out.sort((a, b) => {
    const aTs = new Date(a?.timestamp || 0).getTime();
    const bTs = new Date(b?.timestamp || 0).getTime();
    return bTs - aTs;
  });
}

function formatHistoryItem(item, index) {
  const id = item.id || `${item.timestamp || Date.now()}-${index + 1}`;
  const result = toResultStatus(item);
  const findings = Array.isArray(item.findings) ? item.findings : [];
  const counts = severityCounts(findings);

  return {
    id,
    timestampRaw: item.timestamp || "",
    timestamp: item.timestamp ? new Date(item.timestamp).toLocaleString() : "-",
    branch: item.branch || "unknown",
    commit: item.commitSha || item.commit || "unknown",
    result,
    findings: `${findings.length} findings`,
    findingsCount: findings.length,
    duration: normalizeDuration(item),
    testsPassed: item.testsPassed !== false,
    reason: item.reason || "-",
    diff: item.diffString || item.diff || "No diff data",
    newRoutes: item.newRoutes || [],
    changedFiles: Array.isArray(item.changedFiles) ? item.changedFiles : [],
    severityCounts: counts,
    findingsList: findings,
    reportPath: item.reportPath || "",
    findingsTriggered: findings.map((finding) =>
      `[${String(finding.severity || "info").toUpperCase()}] ${finding.title || "Finding"}`,
    ),
    commitMessage: item.commitMessage || "-",
  };
}

async function getRepoPath() {
  const info = await window.dockium?.project?.getInfo?.();
  return info?.projectInfo?.projectPath || "";
}

export const useGitStore = create((set, get) => ({
  gateInstalled: false,
  hookPath: "-",
  remote: "origin",
  rules: defaultRules,
  pushHistory: [],
  expandedPushId: null,
  lastTestResult: "-",
  liveLogs: [],
  wsBound: false,
  wsUnsubs: [],

  bindRealtime: () => {
    const state = get();
    if (state.wsBound) {
      return;
    }

    const wsApi = window.dockium?.ws;
    if (!wsApi) {
      return;
    }

    const unsubs = [];

    unsubs.push(wsApi.onGitGateStart?.(() => {
      set({ liveLogs: [] });
    }));

    unsubs.push(wsApi.onGitGateLog?.((event) => {
      const payload = event?.data || event || {};
      const message = String(payload?.message || "").trim();
      if (!message) {
        return;
      }

      set((inner) => ({
        liveLogs: [
          ...inner.liveLogs,
          {
            id: `${Date.now()}-${Math.random()}`,
            timestamp: payload?.timestamp || new Date().toISOString(),
            level: String(payload?.level || "info"),
            step: String(payload?.step || ""),
            message,
          },
        ].slice(-500),
      }));
    }));

    unsubs.push(wsApi.onGitGateResult?.((event) => {
      const payload = event?.data || event || {};
      const next = formatHistoryItem(payload, Date.now());
      set((inner) => ({
        pushHistory: [next, ...inner.pushHistory],
        expandedPushId: next.id,
      }));
    }));

    set({
      wsBound: true,
      wsUnsubs: unsubs.filter(Boolean),
    });
  },

  clearLiveLogs: () => set({ liveLogs: [] }),

  loadHistory: async () => {
    const repoPath = await getRepoPath();
    const response = await window.dockium?.git?.loadHistory?.({ repoPath });
    if (!response?.ok) {
      return [];
    }
    return Array.isArray(response.history) ? response.history : [];
  },

  hydrate: async () => {
    const status = await window.dockium?.git?.getGateStatus?.();
    const parsed = status?.status || {};
    const rules = parsed.gateRules || {};
    const runtimeHistory = Array.isArray(parsed.pushHistory) ? parsed.pushHistory : [];
    const persistedHistory = await get().loadHistory();
    const merged = mergeHistoryRecords(persistedHistory, runtimeHistory);
    const history = merged.map(formatHistoryItem);

    const repoPath = await getRepoPath();

    set({
      gateInstalled: Boolean(parsed.isInstalled),
      hookPath: repoPath ? `${repoPath}/.git/hooks/pre-push` : "-",
      rules: { ...defaultRules, ...rules },
      pushHistory: history,
      expandedPushId: history[0]?.id || null,
    });

    get().bindRealtime();
  },

  installGate: async () => {
    const repoPath = await getRepoPath();
    const result = await window.dockium?.git?.installHook?.({ repoPath });
    if (result?.ok) {
      set({ gateInstalled: true, hookPath: `${repoPath}/.git/hooks/pre-push` });
    }
  },

  removeGate: async () => {
    const repoPath = await getRepoPath();
    const result = await window.dockium?.git?.removeHook?.({ repoPath });
    if (result?.ok) {
      set({ gateInstalled: false });
    }
  },

  testGate: async () => {
    const repoPath = await getRepoPath();
    const check = await window.dockium?.git?.gateCheck?.({ repoPath, branch: "manual-test" });
    const allowed = Boolean(check?.result?.allowed);

    set({ lastTestResult: allowed ? "PASS" : "FAIL" });

    if (check?.ok) {
      await get().hydrate();
    }
  },

  toggleRule: (ruleKey) => {
    set((state) => {
      const nextRules = {
        ...state.rules,
        [ruleKey]: !state.rules[ruleKey],
      };
      window.dockium?.git?.setGateRules?.({ rules: nextRules });
      return { rules: nextRules };
    });
  },

  setThreshold: (value) => {
    const parsed = Number(value);
    const threshold = Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 1;

    set((state) => {
      const nextRules = {
        ...state.rules,
        threshold,
      };
      window.dockium?.git?.setGateRules?.({ rules: nextRules });
      return { rules: nextRules };
    });
  },

  toggleExpandedPush: (pushId) => {
    set((state) => ({
      expandedPushId: state.expandedPushId === pushId ? null : pushId,
    }));
  },
}));
