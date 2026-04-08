import React from "react";
import { useNavigate } from "react-router-dom";
import { useUiStore } from "../store/uiStore";

const stepLogLines = [
  "> Pulling node:18-alpine...",
  "> Building app container...",
  "> Skipping dedicated DB container (scanner-first mode)...",
  "> App available at: localhost:3000",
  "> All containers healthy. Ready.",
];

function StepIndicator({ step }) {
  return (
    <div className="onboarding-steps">
      <span className={step >= 1 ? "active" : ""}>1</span>
      <span>&gt;</span>
      <span className={step >= 2 ? "active" : ""}>2</span>
      <span>&gt;</span>
      <span className={step >= 3 ? "active" : ""}>3</span>
      <span>&gt;</span>
      <span className={step >= 4 ? "active" : ""}>4</span>
    </div>
  );
}

export default function Onboarding() {
  const navigate = useNavigate();
  const addToast = useUiStore((state) => state.addToast);
  const setInitialization = useUiStore((state) => state.setInitialization);

  const [step, setStep] = React.useState(1);
  const [projectPath, setProjectPath] = React.useState("");
  const [detection, setDetection] = React.useState(null);
  const [portOverride, setPortOverride] = React.useState("3000");
  const [dbTypeOverride, setDbTypeOverride] = React.useState("PostgreSQL");
  const [bootLogs, setBootLogs] = React.useState([]);
  const [booting, setBooting] = React.useState(false);
  const [bootDone, setBootDone] = React.useState(false);
  const [bootStarted, setBootStarted] = React.useState(false);
  const [dropActive, setDropActive] = React.useState(false);
  const [dockerImageUrl, setDockerImageUrl] = React.useState("");
  const [recentImports, setRecentImports] = React.useState([]);
  const [importingImage, setImportingImage] = React.useState(false);
  const [isMaximized, setIsMaximized] = React.useState(false);
  const [importedImage, setImportedImage] = React.useState("");

  const normalizeDockerImageInput = React.useCallback((value) => {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }

    if (!/^https?:\/\//i.test(raw) && !/^hub\.docker\.com\//i.test(raw)) {
      return raw.replace(/^docker:\/\//i, "");
    }

    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(candidate);
      const host = parsed.hostname.toLowerCase();
      if (host !== "hub.docker.com" && host !== "www.hub.docker.com") {
        return "";
      }

      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length < 3 || segments[0] !== "r") {
        return "";
      }

      const namespace = segments[1] === "_" ? "library" : segments[1];
      const image = segments[2];
      const tag = parsed.searchParams.get("tag") || "latest";
      if (!namespace || !image) {
        return "";
      }

      return `${namespace}/${image}:${tag}`;
    } catch {
      return "";
    }
  }, []);

  const detectProject = React.useCallback(async (pathValue) => {
    const api = window.dockium?.onboardingDetectProject;
    if (!api) {
      return;
    }

    const result = await api({ projectPath: pathValue });
    if (!result?.ok) {
      return;
    }

    setProjectPath(result.projectPath);
    setDetection(result.detection);
  }, []);

  const loadRecentImports = React.useCallback(async () => {
    const api = window.dockium?.docker?.getRecentImports;
    if (!api) {
      return;
    }

    const result = await api();
    if (result?.ok && Array.isArray(result.recent)) {
      setRecentImports(result.recent);
    }
  }, []);

  const persistOnboardingState = React.useCallback(async (projectLoaded) => {
    const api = window.dockium?.onboardingSetState;
    if (!api) {
      return;
    }

    await api({
      projectLoaded,
      projectPath: projectPath || (importedImage ? `docker://${importedImage}` : ""),
      importedImage,
      importedMode: !projectPath && Boolean(importedImage),
      detection,
      config: {
        portOverride: Number(portOverride) || 3000,
        dbTypeOverride,
        useDbContainer: false,
      },
      deferProjectOpen: false,
    });
  }, [dbTypeOverride, detection, importedImage, portOverride, projectPath]);

  const importDockerByUrl = React.useCallback(async (rawUrl) => {
    const url = String(rawUrl || dockerImageUrl).trim();
    if (!url || importingImage) {
      return;
    }

    const normalizedInput = normalizeDockerImageInput(url);
    if (!normalizedInput) {
      addToast({
        type: "error",
        title: "Invalid Docker input",
        message: "Use image:tag or a Docker Hub repository URL.",
      });
      return;
    }

    const api = window.dockium?.docker?.importByUrl;
    if (!api) {
      addToast({
        type: "error",
        title: "Docker import unavailable",
        message: "Container import API is not available.",
        ttlMs: 5000,
      });
      return;
    }

    setImportingImage(true);
    try {
      const result = await api({ url: normalizedInput });
      if (!result?.ok) {
        addToast({
          type: "error",
          title: "Import failed",
          message: result?.error || "Could not import Docker image.",
        });
        return;
      }

      setRecentImports(result.recent || []);
      setImportedImage(result.image || normalizedInput);
      setDockerImageUrl("");
      addToast({
        type: "success",
        title: "Docker image imported",
        message: result.image || normalizedInput,
      });
    } catch (error) {
      addToast({
        type: "error",
        title: "Import failed",
        message: error?.message || "Docker import request failed.",
      });
    } finally {
      setImportingImage(false);
    }
  }, [addToast, dockerImageUrl, importingImage, normalizeDockerImageInput]);

  const runBootInBackground = React.useCallback(async () => {
    if (booting || bootStarted) {
      return;
    }

    setBootStarted(true);
    setBooting(true);
    setBootLogs([]);
    setBootDone(false);

    const pushLog = (line) => {
      setBootLogs((current) => [...current, line]);
    };

    setInitialization({
      active: true,
      message: "Initializing workspace in background",
      needsAi: false,
      startedAt: Date.now(),
    });

    addToast({
      type: "info",
      title: "Initialization started",
      message: "You can open the app now while setup continues.",
      ttlMs: 4000,
    });

    try {
      pushLog("> Initializing ingestion pipeline...");

      const projectApi = window.dockium?.projectOpen;
      const importedApi = window.dockium?.projectOpenImportedImage;
      if (projectApi && projectPath) {
        setInitialization({ active: true, message: "Ingesting project metadata", needsAi: false });
        const opened = await projectApi(projectPath, {
          portOverride: Number(portOverride) || 3000,
          dbTypeOverride,
          useDbContainer: false,
        });

        if (opened?.ok === false) {
          throw new Error(opened.error || "Project ingestion failed");
        }

        pushLog(`> Detected: ${opened?.projectInfo?.framework ?? "unknown"} ${opened?.projectInfo?.version ?? ""}`);
        pushLog("> Generated .dockium config and Dockerfile");
      } else if (importedApi && importedImage) {
        setInitialization({ active: true, message: "Hydrating imported image metadata", needsAi: false });
        const opened = await importedApi(importedImage, {
          portOverride: Number(portOverride) || 3000,
          dbTypeOverride,
          useDbContainer: false,
        });
        if (opened?.ok === false) {
          throw new Error(opened.error || "Imported image hydration failed");
        }
        pushLog(`> Imported image: ${importedImage}`);
        pushLog("> Built virtual project map from container metadata");
      } else {
        pushLog("> Project API unavailable - using local mode");
      }

      const dockerStart = window.dockium?.docker?.startAll;
      if (dockerStart && (projectPath || importedImage)) {
        setInitialization({ active: true, message: "Starting Docker containers", needsAi: false });
        pushLog("> Starting security stack containers (scanner + proxy)...");
        const started = await dockerStart();
        if (started?.ok === false) {
          throw new Error(started.error || "Container startup failed");
        }
        const startedContainers = Array.isArray(started?.result?.containers)
          ? started.result.containers.join(", ")
          : "scanner, proxy, app";
        pushLog(`> Started containers: ${startedContainers}`);
        pushLog("> Containers healthy. Ready.");
      } else {
        stepLogLines.forEach((line) => pushLog(line));
      }

      setBootDone(true);
      setBooting(false);
      setStep(4);
      setInitialization({ active: false, message: "Workspace ready", needsAi: false, startedAt: null });
      addToast({
        type: "success",
        title: "Initialization complete",
        message: "Workspace is ready.",
        ttlMs: 4000,
      });
    } catch (error) {
      pushLog(`> ERROR: ${error.message}`);
      setBooting(false);
      setInitialization({ active: false, message: "Initialization failed", needsAi: false, startedAt: null });
      addToast({
        type: "error",
        title: "Initialization failed",
        message: error.message,
        ttlMs: 6000,
      });
    }
  }, [
    addToast,
    bootStarted,
    booting,
    dbTypeOverride,
    importedImage,
    portOverride,
    projectPath,
    setInitialization,
  ]);

  React.useEffect(() => {
    const api = window.dockium?.window;
    if (!api) {
      return undefined;
    }

    let active = true;
    api.isMaximized?.().then((state) => {
      if (active && state?.ok) {
        setIsMaximized(Boolean(state.isMaximized));
      }
    });

    const unsubscribe = api.onMaximizeChanged?.((payload) => {
      setIsMaximized(Boolean(payload?.isMaximized));
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  React.useEffect(() => {
    let mounted = true;
    const loadState = async () => {
      const api = window.dockium?.onboardingGetState;
      if (!api) {
        return;
      }

      const state = await api();
      if (!mounted || !state) {
        return;
      }

      if (state.projectLoaded) {
        navigate("/dashboard", { replace: true });
        return;
      }

      if (state.importedImage) {
        setImportedImage(state.importedImage);
      }

      if (state.projectPath) {
        setProjectPath(state.projectPath);
      }

      if (state.detection) {
        setDetection(state.detection);
      }

      if (state.config?.portOverride) {
        setPortOverride(String(state.config.portOverride));
      }

      if (state.config?.dbTypeOverride) {
        setDbTypeOverride(state.config.dbTypeOverride);
      }
    };

    loadState();
    loadRecentImports();
    setInitialization({ active: false, message: "", needsAi: false, startedAt: null });

    return () => {
      mounted = false;
    };
  }, [loadRecentImports, navigate, setInitialization]);

  React.useEffect(() => {
    if (step !== 3 || bootStarted) {
      return;
    }
    runBootInBackground();
  }, [bootStarted, runBootInBackground, step]);

  React.useEffect(() => {
    const wsApi = window.dockium?.ws;
    if (!booting || !wsApi?.onLog) {
      return undefined;
    }

    const unsub = wsApi.onLog((event) => {
      const message = String(event?.data?.message || event?.message || "").trim();
      if (!message) {
        return;
      }

      if (!/docker|pull|pulled|container|scanner|proxy|healthy|starting/i.test(message)) {
        return;
      }

      setBootLogs((current) => {
        const next = [...current, `> ${message}`];
        return next.slice(-120);
      });
    });

    return () => {
      unsub?.();
    };
  }, [booting]);

  const handleDrop = async (event) => {
    event.preventDefault();
    setDropActive(false);

    const first = event.dataTransfer.files?.[0];
    const droppedPath = first?.path;
    if (!droppedPath) {
      return;
    }

    await detectProject(droppedPath);
  };

  const browseProject = async () => {
    const api = window.dockium?.onboardingBrowseProject;
    if (!api) {
      return;
    }

    const result = await api();
    if (!result?.ok) {
      return;
    }

    setProjectPath(result.projectPath);
    setDetection(result.detection);
  };

  const completeOnboarding = async () => {
    if (!projectPath && !importedImage) {
      addToast({
        type: "error",
        title: "Project required",
        message: "Select a project folder or import a container image before continuing.",
      });
      return;
    }

    if (!bootStarted && (projectPath || importedImage)) {
      setStep(3);
      runBootInBackground();
    }

    await persistOnboardingState(true);
    navigate("/dashboard", { replace: true });
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((current) => Math.max(1, current - 1));
      return;
    }

    navigate("/dashboard");
  };

  const detectedSummary = detection
    ? `> Detected: ${detection.framework} ${detection.version} - ${
        detection.hasNodeModules ? "node_modules found" : "node_modules missing"
      }, ${detection.hasEnvExample ? ".env.example found" : ".env.example missing"}`
    : "";

  return (
    <section className="onboarding-page">
      <div className="onboarding-titlebar">
        <button className="onboarding-titlebar-back" onClick={handleBack}>Back</button>
        <span className="onboarding-titlebar-title">Dockium Setup</span>
        <div className="onboarding-window-controls">
          <button type="button" className="window-control no-drag" onClick={() => window.dockium?.window?.minimize?.()}>
            -
          </button>
          <button
            type="button"
            className="window-control no-drag"
            onClick={() => window.dockium?.window?.toggleMaximize?.()}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? "[]" : "[ ]"}
          </button>
          <button
            type="button"
            className="window-control close no-drag"
            onClick={() => window.dockium?.window?.close?.()}
            title="Close"
          >
            x
          </button>
        </div>
      </div>

      <div className="onboarding-card">
        <header className="onboarding-head">
          <h1>DOCKIUM Onboarding</h1>
          <p className="onboarding-subtitle">Initialization runs locally. AI is optional and not required for setup.</p>
          <StepIndicator step={step} />
        </header>

        <div className="onboarding-body">
          {step === 1 ? (
            <section className="onboarding-step">
              <h2>Step 1 - Select Project</h2>
              <div
                className={dropActive ? "onboarding-dropzone active" : "onboarding-dropzone"}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropActive(true);
                }}
                onDragLeave={() => setDropActive(false)}
                onDrop={handleDrop}
              >
                <p>Drop your project folder here or</p>
                <button className="onboarding-btn" onClick={browseProject}>Browse</button>
              </div>
              {projectPath ? <p className="onboarding-path">Path: {projectPath}</p> : null}
              {detectedSummary ? <p className="onboarding-detected">{detectedSummary}</p> : null}

              <div className="onboarding-form-row">
                <label>Docker image URL (optional)</label>
                <div className="onboarding-inline-row">
                  <input
                    value={dockerImageUrl}
                    placeholder="ghcr.io/your-org/your-image:latest"
                    onChange={(event) => setDockerImageUrl(event.target.value)}
                  />
                  <button
                    className="onboarding-btn"
                    onClick={() => importDockerByUrl()}
                    disabled={!dockerImageUrl.trim() || importingImage}
                  >
                    {importingImage ? "Importing..." : "Import"}
                  </button>
                </div>
              </div>

              {recentImports.length > 0 ? (
                <div className="onboarding-recent-box">
                  <p className="onboarding-recent-title">Recent Docker Imports</p>
                  {recentImports.map((item) => (
                    <button
                      key={`${item.url}-${item.importedAt}`}
                      className="onboarding-recent-item"
                      onClick={() => {
                        setDockerImageUrl(item.url);
                        setImportedImage(item.url);
                      }}
                    >
                      {item.url}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {step === 2 ? (
            <section className="onboarding-step">
              <h2>Step 2 - Review Config</h2>
              <div className="onboarding-review">
                <p>&gt; Will generate Dockerfile for Next.js</p>
                <p>&gt; Will clone schema from: {detection?.schemaPath ?? "prisma/schema.prisma"}</p>
                <p>&gt; Dedicated DB container is disabled for this scanner-first run</p>
                <p>&gt; Will map routes from: {detection?.routeMapSource ?? "src/app/**"}</p>
              </div>
              <div className="onboarding-form-row">
                <label>Port override</label>
                <input value={portOverride} onChange={(event) => setPortOverride(event.target.value)} />
              </div>
              <div className="onboarding-form-row">
                <label>DB type override</label>
                <select value={dbTypeOverride} onChange={(event) => setDbTypeOverride(event.target.value)}>
                  <option value="PostgreSQL">PostgreSQL</option>
                  <option value="MySQL">MySQL</option>
                  <option value="SQLite">SQLite</option>
                </select>
              </div>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="onboarding-step">
              <h2>Step 3 - Initialize In Background</h2>
              <p className="onboarding-ready">You can enter the app now. Initialization continues in the background.</p>
              <div className="onboarding-log-box">
                {bootLogs.length === 0 ? <p>&gt; Waiting for initialization logs...</p> : null}
                {bootLogs.map((line, index) => (
                  <p key={`boot-log-${index}`}>{line}</p>
                ))}
              </div>
            </section>
          ) : null}

          {step === 4 ? (
            <section className="onboarding-step">
              <h2>Step 4 - Ready</h2>
              <p className="onboarding-ready">All containers healthy. Workspace is ready.</p>
              <button className="onboarding-btn onboarding-btn-primary" onClick={completeOnboarding}>
                Go to Dashboard
              </button>
            </section>
          ) : null}
        </div>

        <footer className="onboarding-footer">
          <div className="onboarding-footer-actions">
            <button className="onboarding-btn" onClick={handleBack}>
              Back
            </button>
            {step < 4 ? (
              <button
                className="onboarding-btn onboarding-btn-primary"
                onClick={() => setStep((current) => Math.min(4, current + 1))}
                disabled={step === 1 && !detection && !importedImage}
              >
                Next
              </button>
            ) : null}
          </div>

          <button className="onboarding-btn onboarding-btn-primary" onClick={completeOnboarding}>
            {booting ? "Open App While Initializing" : "Open App Now"}
          </button>
        </footer>
      </div>
    </section>
  );
}
