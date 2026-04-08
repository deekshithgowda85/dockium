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

function formatHistoryItem(item, index) {
  const id = item.id || index + 1;
  const result = String(item.result || "FORWARDED").toUpperCase();
  const findings = Array.isArray(item.findings) ? item.findings : [];

  return {
    id,
    timestamp: item.timestamp ? new Date(item.timestamp).toLocaleString() : "-",
    branch: item.branch || "unknown",
    commit: item.commitSha || item.commit || "unknown",
    result,
    findings: `${findings.length} findings`,
    duration: item.duration || "-",
    reason: item.reason || "-",
    diff: item.diffString || item.diff || "No diff data",
    newRoutes: item.newRoutes || [],
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

  hydrate: async () => {
    const status = await window.dockium?.git?.getGateStatus?.();
    const parsed = status?.status || {};
    const rules = parsed.gateRules || {};
    const history = (parsed.pushHistory || []).map(formatHistoryItem);

    const repoPath = await getRepoPath();

    set({
      gateInstalled: Boolean(parsed.isInstalled),
      hookPath: repoPath ? `${repoPath}/.git/hooks/pre-push` : "-",
      rules: { ...defaultRules, ...rules },
      pushHistory: history,
      expandedPushId: history[0]?.id || null,
    });
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

    set((state) => {
      if (!check?.ok) {
        return { lastTestResult: allowed ? "PASS" : "FAIL" };
      }

      const entry = formatHistoryItem(
        {
          ...check.result,
          timestamp: new Date().toISOString(),
          branch: "manual-test",
          commitSha: "manual",
          result: allowed ? "FORWARDED" : "BLOCKED",
        },
        Date.now(),
      );

      return {
        lastTestResult: allowed ? "PASS" : "FAIL",
        pushHistory: [entry, ...state.pushHistory],
        expandedPushId: entry.id,
      };
    });
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
