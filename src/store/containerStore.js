import { create } from "zustand";

const initialContainers = [];

function toStatus(value) {
  return String(value || "stopped").toUpperCase();
}

function toContainerRows(stats) {
  return (stats || []).map((item) => ({
    name: item.name,
    status: toStatus(item.status),
    port: item.port || (Array.isArray(item.ports) && item.ports.length > 0 ? item.ports.join(", ") : "--"),
    cpu: `${Number(item.cpuPercent ?? item.cpu ?? 0).toFixed(1)}%`,
    mem: `${Math.round(Number(item.memMB ?? 0))}MB`,
  }));
}

export const useContainerStore = create((set, get) => ({
  projectName: "No project",
  projectPath: "No project loaded",
  framework: "Unknown",
  targetUrl: "--",
  dbType: "--",
  routeCount: 0,
  appStatus: "STOPPED",
  containers: initialContainers,

  hydrate: async () => {
    let projectInfo = await window.dockium?.project?.getInfo?.();
    const state = await window.dockium?.onboardingGetState?.();

    if (!projectInfo?.projectInfo) {
      if (state?.projectLoaded) {
        const importedMode = Boolean(state.importedMode)
          || String(state.projectPath || "").startsWith("docker://")
          || Boolean(state.importedImage);

        if (importedMode && state.importedImage) {
          await window.dockium?.project?.openImportedImage?.({
            image: state.importedImage,
            options: state.config || {},
          });
        } else if (state.projectPath) {
          await window.dockium?.project?.open?.({
            projectPath: state.projectPath,
            options: state.config || {},
          });
        }

        projectInfo = await window.dockium?.project?.getInfo?.();
      }
    }

    let dockerStats = await window.dockium?.docker?.getStats?.();
    const rowsFromStats = toContainerRows(dockerStats?.stats || []);
    const hasRunning = rowsFromStats.some((item) => item.status === "RUNNING");

    if (state?.projectLoaded && !hasRunning) {
      const startResult = await window.dockium?.docker?.startAll?.();
      if (startResult?.ok) {
        dockerStats = await window.dockium?.docker?.getStats?.();
      }
    }

    const rows = toContainerRows(dockerStats?.stats || []);
    const runningNow = rows.some((item) => item.status === "RUNNING");

    set({
      projectName: projectInfo?.projectInfo?.name || get().projectName,
      projectPath: projectInfo?.projectInfo?.projectPath || get().projectPath,
      framework: projectInfo?.projectInfo
        ? `${projectInfo.projectInfo.framework} ${projectInfo.projectInfo.version || ""}`.trim()
        : get().framework,
      targetUrl: projectInfo?.projectInfo?.targetUrl || get().targetUrl,
      dbType: projectInfo?.projectInfo?.dbType || get().dbType,
      routeCount: Number(projectInfo?.projectInfo?.routeCount || 0),
      appStatus: runningNow ? "RUNNING" : "STOPPED",
      containers: rows.length > 0 ? rows : get().containers,
    });
  },

  openProject: async () => {
    await get().hydrate();
  },

  stopAll: async () => {
    await window.dockium?.docker?.stopAll?.();
    await window.dockium?.proxy?.stop?.();
    set((state) => ({
      appStatus: "STOPPED",
      containers: state.containers.map((container) => ({
        ...container,
        status: "STOPPED",
        cpu: "0.0%",
      })),
    }));
  },

  restartAll: async () => {
    set((state) => ({
      appStatus: "BOOTING",
      containers: state.containers.map((container) => ({
        ...container,
        status: "BOOTING",
      })),
    }));

    await window.dockium?.docker?.stopAll?.();
    await window.dockium?.docker?.startAll?.();
    await get().hydrate();
  },
}));
