import React from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import ActiveScanPage from "./pages/ActiveScanPage";
import AppMap from "./pages/AppMap";
import CvePage from "./pages/CvePage";
import Dashboard from "./pages/Dashboard";
import GitGate from "./pages/GitGate";
import Onboarding from "./pages/Onboarding";
import ProxyView from "./pages/ProxyView";
import Report from "./pages/Report";
import Scanner from "./pages/Scanner";
import SecretsPage from "./pages/SecretsPage";
import Settings from "./pages/Settings";
import SnapshotsPage from "./pages/SnapshotsPage";
import { useContainerStore } from "./store/containerStore";
import { useFleetStore } from "./store/fleetStore";
import { useScanStore } from "./store/scanStore";
import { useProxyStore } from "./store/proxyStore";
import { useGitStore } from "./store/gitStore";
import { useMapStore } from "./store/mapStore";

function HomeRedirect() {
  const [targetPath, setTargetPath] = React.useState(null);

  React.useEffect(() => {
    let mounted = true;

    const resolveTarget = async () => {
      const api = window.dockium?.onboardingGetState;
      if (!api) {
        if (mounted) {
          setTargetPath("/dashboard");
        }
        return;
      }

      try {
        const state = await api();
        if (!mounted) {
          return;
        }

        if (state?.projectLoaded) {
          try {
            const isImportedMode = Boolean(state?.importedMode)
              || String(state?.projectPath || "").startsWith("docker://")
              || Boolean(state?.importedImage);

            if (isImportedMode && window.dockium?.projectOpenImportedImage && state?.importedImage) {
              await window.dockium.projectOpenImportedImage(state.importedImage, state.config || {});
            } else if (state?.projectPath && window.dockium?.projectOpen) {
              await window.dockium.projectOpen(state.projectPath, state.config || {});
            }
          } catch {
            // Continue routing even if reopen fails; user can re-open from onboarding.
          }
        }

        setTargetPath(state?.projectLoaded ? "/dashboard" : "/onboarding");
      } catch {
        if (mounted) {
          setTargetPath("/dashboard");
        }
      }
    };

    resolveTarget();

    return () => {
      mounted = false;
    };
  }, []);

  if (!targetPath) {
    return <div className="onboarding-loading-route">Loading workspace...</div>;
  }

  return <Navigate to={targetPath} replace />;
}

function NewProjectSetupRedirect() {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    const prepare = async () => {
      try {
        const getState = window.dockium?.onboardingGetState;
        const setState = window.dockium?.onboardingSetState;
        if (getState && setState) {
          const state = await getState();
          await setState({
            ...(state || {}),
            projectLoaded: false,
            deferProjectOpen: true,
          });
        }
      } finally {
        if (active) {
          setReady(true);
        }
      }
    };

    prepare();
    return () => {
      active = false;
    };
  }, []);

  if (!ready) {
    return <div className="onboarding-loading-route">Preparing setup...</div>;
  }

  return <Navigate to="/onboarding" replace />;
}

export default function App() {
  React.useEffect(() => {
    useContainerStore.getState().hydrate?.();
    useProxyStore.getState().hydrate?.();
    useGitStore.getState().hydrate?.();
    useMapStore.getState().hydrate?.();
    useScanStore.getState().hydrateStatus?.();
    useFleetStore.getState().hydrate?.();
  }, []);

  React.useEffect(() => {
    const wsApi = window.dockium?.ws;
    if (!wsApi) {
      return undefined;
    }

    wsApi.connect?.();

    const unsubLog = wsApi.onLog?.((event) => {
      const message = event?.message || event?.data?.message || "Dockium event";
      const now = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });

      useScanStore.setState((state) => ({
        activityLog: [{ time: now, message }, ...state.activityLog].slice(0, 40),
      }));
    });

    const unsubFinding = wsApi.onFinding?.((event) => {
      const finding = event?.data || event?.finding || event || {};
      const id = `live-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const severity = String(finding.severity || "info").toLowerCase();

      useScanStore.setState((state) => ({
        findings: [
          {
            id,
            severity,
            title: finding.title || finding.name || "Live finding",
            endpoint: finding.endpoint || finding.url || "Unknown endpoint",
            payload: finding.payload || "n/a",
            response: finding.response || "n/a",
            proof: finding.proof || finding.description || "No proof provided",
            fix: finding.fix || finding.solution || "No fix provided",
            request: finding.request || "n/a",
            what: finding.description || "No description provided",
          },
          ...state.findings,
        ].slice(0, 500),
      }));
    });

    const unsubContainer = wsApi.onContainerUpdate?.((event) => {
      const name = event?.container || event?.name || event?.data?.name;
      const status = String(event?.status || event?.data?.status || "unknown").toUpperCase();
      if (!name) {
        return;
      }

      useContainerStore.setState((state) => {
        const found = state.containers.some((item) => item.name === name);
        if (!found) {
          return {
            containers: [
              ...state.containers,
              { name, status, port: "--", cpu: "0%", mem: "0MB" },
            ],
          };
        }

        return {
          containers: state.containers.map((item) =>
            item.name === name ? { ...item, status } : item,
          ),
        };
      });
    });

    const unsubRequest = wsApi.onRequest?.((event) => {
      const req = event?.data || event || {};
      const statusCode = Number(req.status || req.responseStatus || 0) || 0;
      const id = Number(req.id) || Date.now();
      const method = String(req.method || "GET").toUpperCase();
      const host = req.host || "localhost";
      const path = req.path || "/";

      useProxyStore.setState((state) => ({
        requests: [
          ...state.requests,
          {
            id,
            method,
            host,
            path,
            status: statusCode,
            timeMs: req.durationMs || 0,
            flag: req.flag || "--",
            requestRaw: req.requestBody || `${method} ${path} HTTP/1.1`,
            responseRaw: req.responseBody || "",
          },
        ].slice(-10000),
      }));
    });

    const unsubScanProgress = wsApi.onScanProgress?.((event) => {
      useScanStore.getState().setProgressFromEvent?.(event?.data || event || {});
    });

    const unsubScanComplete = wsApi.onScanComplete?.(() => {
      useScanStore.getState().hydrateStatus?.();
    });

    const unsubFleet = wsApi.onFleet?.((event) => {
      useFleetStore.getState().applyFleetEvent?.(event);
    });

    return () => {
      unsubLog?.();
      unsubFinding?.();
      unsubContainer?.();
      unsubRequest?.();
      unsubScanProgress?.();
      unsubScanComplete?.();
      unsubFleet?.();
    };
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="new-project" element={<NewProjectSetupRedirect />} />
          <Route path="app-map" element={<AppMap />} />
          <Route path="proxy" element={<ProxyView />} />
          <Route path="scanner" element={<Scanner />} />
          <Route path="active-scan" element={<ActiveScanPage />} />
          <Route path="browser-fleet" element={<Navigate to="/scanner" replace />} />
          <Route path="secrets" element={<SecretsPage />} />
          <Route path="cve-scanner" element={<CvePage />} />
          <Route path="git-gate" element={<GitGate />} />
          <Route path="report" element={<Report />} />
          <Route path="snapshots" element={<SnapshotsPage />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}