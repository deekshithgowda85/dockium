import React from "react";
import { useMapStore } from "../store/mapStore";

const viewTabs = [
  { id: "files", label: "File Paths" },
  { id: "pages", label: "Pages Tree" },
  { id: "api", label: "API Routes" },
];

function prettyJson(value) {
  if (value === null || value === undefined) {
    return "--";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "--";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return date.toLocaleString();
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("live")) return "live";
  if (value.includes("failed")) return "failed";
  if (value.includes("required")) return "required";
  return "public";
}

function methodClass(method) {
  return `appmap-method appmap-method-${String(method || "GET").toLowerCase()}`;
}

function buildPagesTree(routes = []) {
  const root = {
    id: "root",
    segment: "/",
    children: [],
    routeCount: 0,
    methods: new Set(),
  };

  const childMap = new Map();
  childMap.set("root", new Map());

  routes.forEach((route) => {
    const pathValue = String(route?.path || "/");
    const segments = pathValue.split("/").filter(Boolean);
    const method = String(route?.method || "GET").toUpperCase();

    if (segments.length === 0) {
      root.routeCount += 1;
      root.methods.add(method);
      return;
    }

    let currentNode = root;
    let currentKey = "root";
    segments.forEach((segment, index) => {
      const segmentMap = childMap.get(currentKey) || new Map();
      if (!childMap.has(currentKey)) {
        childMap.set(currentKey, segmentMap);
      }

      let nextNode = segmentMap.get(segment);
      if (!nextNode) {
        const id = `${currentKey}/${segment}`;
        nextNode = {
          id,
          segment,
          children: [],
          routeCount: 0,
          methods: new Set(),
        };
        segmentMap.set(segment, nextNode);
        childMap.set(id, new Map());
        currentNode.children.push(nextNode);
      }

      nextNode.methods.add(method);
      nextNode.routeCount += 1;

      currentNode = nextNode;
      currentKey = nextNode.id;
    });
  });

  const normalize = (node) => ({
    ...node,
    methods: [...node.methods].sort(),
    children: node.children
      .sort((a, b) => a.segment.localeCompare(b.segment))
      .map(normalize),
  });

  return normalize(root);
}

function TreeNode({ node, depth, expandedFolders, selectedFilePath, onToggleFolder, onSelectFile }) {
  const isFolder = node.kind === "folder";
  const expanded = Boolean(expandedFolders[node.id]);
  const selected = !isFolder && node.path === selectedFilePath;

  return (
    <>
      <div
        className={isFolder ? "appmap-tree-row appmap-tree-folder" : "appmap-tree-row appmap-tree-file"}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        onClick={() => {
          if (isFolder) {
            onToggleFolder(node.id);
            return;
          }
          onSelectFile(node.path);
        }}
      >
        <span className="appmap-tree-name">
          {isFolder ? (expanded ? "▾" : "▸") : "•"} {node.name}
        </span>
        {node.routeCount > 0 ? <span className="appmap-tree-badge">{node.routeCount}</span> : null}
        {!isFolder && selected ? <span className="appmap-tree-selected">selected</span> : null}
      </div>

      {isFolder && expanded
        ? (node.children || []).map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              selectedFilePath={selectedFilePath}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
            />
          ))
        : null}
    </>
  );
}

function PageGraphNode({ node, depth }) {
  return (
    <div className="appmap-page-node-wrap">
      <div className="appmap-page-node" style={{ marginLeft: `${depth * 14}px` }}>
        <span className="appmap-page-segment">{node.segment}</span>
        {node.routeCount > 0 ? <span className="appmap-page-count">{node.routeCount}</span> : null}
        {node.methods.length > 0 ? <span className="appmap-page-methods">{node.methods.join(" ")}</span> : null}
      </div>
      {(node.children || []).map((child) => (
        <PageGraphNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function RouteCard({ route, selected, expanded, testDraft, onSelect, onToggleExpand, onToggleTest, onTestDraftChange, onRunTest }) {
  return (
    <article className={selected ? "appmap-route-card selected" : "appmap-route-card"}>
      <header className="appmap-route-head">
        <div className="appmap-route-main" onClick={onSelect}>
          <span className={methodClass(route.method)}>{route.method}</span>
          <div>
            <h3>{route.fullPath}</h3>
            <p>{route.handlerName}</p>
            <button type="button" className="appmap-source-link" onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}>
              {route.sourceFile}:{route.sourceLine}
            </button>
          </div>
        </div>
        <div className="appmap-route-actions">
          <span className={`appmap-auth-badge ${statusClass(route.authStatus)}`}>{route.authStatus}</span>
          {!route.sourceReadable ? <span className="appmap-source-warn">SOURCE UNREADABLE</span> : null}
          <button type="button" className="appmap-inline-btn" onClick={onToggleExpand}>{expanded ? "Collapse" : "Expand"}</button>
          <button type="button" className="appmap-inline-btn" onClick={onToggleTest}>Test</button>
        </div>
      </header>

      {expanded ? (
        <div className="appmap-route-expand">
          <div className="appmap-meta-grid">
            <div>
              <label>Auth + Permissions</label>
              <pre>{prettyJson({ required: route.authRequired, roles: route.roles, permissions: route.permissions })}</pre>
            </div>
            <div>
              <label>Request Schema</label>
              <pre>{prettyJson(route.request)}</pre>
            </div>
            <div>
              <label>Response Schema</label>
              <pre>{prettyJson(route.response)}</pre>
            </div>
            {!route.sourceReadable ? (
              <div>
                <label>Source Read Warning</label>
                <pre>{route.sourceWarning || "Source file not readable"}</pre>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {testDraft?.open ? (
        <div className="appmap-test-panel">
          <div className="appmap-test-grid">
            <label>
              Headers (JSON or key:value)
              <textarea
                value={testDraft.headersText}
                onChange={(event) => onTestDraftChange({ headersText: event.target.value })}
              />
            </label>
            <label>
              Path Params (name=value)
              <textarea
                value={testDraft.paramsText}
                onChange={(event) => onTestDraftChange({ paramsText: event.target.value })}
              />
            </label>
            <label>
              Body (JSON)
              <textarea
                value={testDraft.bodyText}
                onChange={(event) => onTestDraftChange({ bodyText: event.target.value })}
              />
            </label>
          </div>

          <div className="appmap-test-actions">
            <button type="button" className="appmap-inline-btn" onClick={onRunTest} disabled={testDraft.loading}>
              {testDraft.loading ? "Testing..." : "Run Test"}
            </button>
            {testDraft.error ? <span className="appmap-test-error">{testDraft.error}</span> : null}
          </div>

          {testDraft.result ? (
            <pre className="appmap-test-result">{prettyJson(testDraft.result.liveResponse || testDraft.result)}</pre>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default function AppMap() {
  const [activeTab, setActiveTab] = React.useState("files");
  const [showOpenApiDebug, setShowOpenApiDebug] = React.useState(false);
  const bootScanTriggered = React.useRef(false);
  const [projectInfo, setProjectInfo] = React.useState(null);
  const hasProjectContext = Boolean(projectInfo?.projectPath);
  const loading = useMapStore((state) => state.loading);
  const error = useMapStore((state) => state.error);
  const sourceMode = useMapStore((state) => state.sourceMode);
  const folderTree = useMapStore((state) => state.folderTree);
  const routes = useMapStore((state) => state.routes);
  const warnings = useMapStore((state) => state.warnings);
  const openApiSummary = useMapStore((state) => state.openApiSummary);
  const openApiDiagnostics = useMapStore((state) => state.openApiDiagnostics);
  const authInfo = useMapStore((state) => state.authInfo);
  const linkedSourcePath = useMapStore((state) => state.linkedSourcePath);
  const packageGroups = useMapStore((state) => state.packageGroups);
  const scannedAt = useMapStore((state) => state.scannedAt);
  const scanStatus = useMapStore((state) => state.scanStatus);
  const searchQuery = useMapStore((state) => state.searchQuery);
  const authFilter = useMapStore((state) => state.authFilter);
  const tokenInput = useMapStore((state) => state.tokenInput);
  const appliedToken = useMapStore((state) => state.appliedToken);
  const expandedFolders = useMapStore((state) => state.expandedFolders);
  const expandedRoutes = useMapStore((state) => state.expandedRoutes);
  const selectedRouteId = useMapStore((state) => state.selectedRouteId);
  const selectedFilePath = useMapStore((state) => state.selectedFilePath);
  const fileFilterPath = useMapStore((state) => state.fileFilterPath);
  const routeTests = useMapStore((state) => state.routeTests);

  const hydrate = useMapStore((state) => state.hydrate);
  const refresh = useMapStore((state) => state.refresh);
  const applyToken = useMapStore((state) => state.applyToken);
  const pollScanStatus = useMapStore((state) => state.pollScanStatus);
  const setSearchQuery = useMapStore((state) => state.setSearchQuery);
  const setAuthFilter = useMapStore((state) => state.setAuthFilter);
  const setTokenInput = useMapStore((state) => state.setTokenInput);
  const toggleFolder = useMapStore((state) => state.toggleFolder);
  const selectFile = useMapStore((state) => state.selectFile);
  const clearFileFilter = useMapStore((state) => state.clearFileFilter);
  const selectRoute = useMapStore((state) => state.selectRoute);
  const toggleRouteExpand = useMapStore((state) => state.toggleRouteExpand);
  const toggleTestPanel = useMapStore((state) => state.toggleTestPanel);
  const updateTestDraft = useMapStore((state) => state.updateTestDraft);
  const runRouteTest = useMapStore((state) => state.runRouteTest);

  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

  React.useEffect(() => {
    if (!scanStatus.active) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      pollScanStatus();
    }, 1200);
    return () => window.clearInterval(timer);
  }, [pollScanStatus, scanStatus.active]);

  React.useEffect(() => {
    if (!hasProjectContext || bootScanTriggered.current || loading || scanStatus.active) {
      return;
    }

    if (routes.length > 0) {
      return;
    }

    bootScanTriggered.current = true;
    refresh();
  }, [hasProjectContext, loading, refresh, routes.length, scanStatus.active]);

  React.useEffect(() => {
    let mounted = true;

    const loadProjectInfo = async () => {
      const response = await window.dockium?.project?.getInfo?.();
      if (!mounted) {
        return;
      }
      if (!response?.ok) {
        setProjectInfo(null);
        return;
      }
      setProjectInfo(response.projectInfo || null);
    };

    loadProjectInfo();
    return () => {
      mounted = false;
    };
  }, [scanStatus.completedAt]);

  const attachSourceFolder = React.useCallback(async () => {
    const browse = window.dockium?.onboardingBrowseProject;
    const openImported = window.dockium?.project?.openImportedImage;
    if (!browse || !openImported || !projectInfo?.name) {
      return;
    }

    const picked = await browse();
    if (!picked?.ok || !picked.projectPath) {
      return;
    }

    const response = await openImported({
      image: projectInfo.name,
      options: {
        sourceRepoPath: picked.projectPath,
      },
    });

    if (response?.ok) {
      await hydrate();
      await refresh();
    }
  }, [hydrate, projectInfo?.name, refresh]);

  const filteredRoutes = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return routes.filter((route) => {
      const fileOk = !fileFilterPath || route.sourceFile === fileFilterPath;
      const status = String(route.authStatus || "").toLowerCase();
      const authOk = authFilter === "ALL"
        || (authFilter === "PUBLIC" && status.includes("public"))
        || (authFilter === "AUTH REQUIRED" && status.includes("required"))
        || (authFilter === "AUTHED + LIVE DATA" && status.includes("live"))
        || (authFilter === "AUTH FAILED" && status.includes("failed"));

      if (!fileOk || !authOk) {
        return false;
      }

      if (!query) {
        return true;
      }

      const text = `${route.method} ${route.path} ${route.handlerName} ${route.sourceFile}`.toLowerCase();
      return text.includes(query);
    });
  }, [routes, fileFilterPath, searchQuery, authFilter]);

  const authCounts = React.useMemo(() => {
    const counts = {
      public: 0,
      required: 0,
      live: 0,
      failed: 0,
    };

    routes.forEach((route) => {
      const status = String(route.authStatus || "").toLowerCase();
      if (status.includes("failed")) counts.failed += 1;
      else if (status.includes("live")) counts.live += 1;
      else if (status.includes("required")) counts.required += 1;
      else counts.public += 1;
    });

    return counts;
  }, [routes]);

  const groupedRoutes = React.useMemo(() => {
    const groups = new Map();
    filteredRoutes.forEach((route) => {
      const key = route.packageName || "project";
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(route);
    });
    return [...groups.entries()];
  }, [filteredRoutes]);

  const effectiveAuthInfo = authInfo || scanStatus?.authInfo || null;

  const pagesTree = React.useMemo(() => buildPagesTree(routes), [routes]);

  const virtualSources = React.useMemo(() => {
    const map = new Map();
    routes.forEach((route) => {
      const key = String(route.sourceFile || "unresolved");
      map.set(key, Number(map.get(key) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [routes]);

  return (
    <section className="appmap-v2-page">
      <header className="appmap-v2-header">
        <div className="appmap-v2-title-row">
          <h2>Application Map</h2>
          <span>Runtime router introspection + auth-aware live metadata</span>
        </div>

        <div className="appmap-v2-toolbar">
          <input
            className="appmap-v2-search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search path, method, handler"
          />

          <div className="appmap-v2-auth-row">
            <input
              className="appmap-v2-token"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="Paste Bearer token, cookie, or API key"
            />
            <button type="button" className="appmap-v2-btn" onClick={applyToken} disabled={!hasProjectContext}>Apply</button>
            <button type="button" className="appmap-v2-btn" onClick={refresh} disabled={!hasProjectContext}>Refresh</button>
          </div>
        </div>

        <div className="appmap-v2-meta-row">
          <span>Routes {routes.length}</span>
          <span>Filtered {filteredRoutes.length}</span>
          <span>Scanned {formatTimestamp(scannedAt)}</span>
          <span>Token {appliedToken ? "applied" : "auto"}</span>
        </div>

        <div className="appmap-v2-authfilters" aria-label="Auth filters">
          <button
            type="button"
            className={authFilter === "ALL" ? "appmap-v2-tab active" : "appmap-v2-tab"}
            onClick={() => setAuthFilter("ALL")}
          >
            All
          </button>
          <button
            type="button"
            className={authFilter === "PUBLIC" ? "appmap-v2-tab active" : "appmap-v2-tab"}
            onClick={() => setAuthFilter("PUBLIC")}
          >
            Public {authCounts.public}
          </button>
          <button
            type="button"
            className={authFilter === "AUTH REQUIRED" ? "appmap-v2-tab active" : "appmap-v2-tab"}
            onClick={() => setAuthFilter("AUTH REQUIRED")}
          >
            Required {authCounts.required}
          </button>
          <button
            type="button"
            className={authFilter === "AUTHED + LIVE DATA" ? "appmap-v2-tab active" : "appmap-v2-tab"}
            onClick={() => setAuthFilter("AUTHED + LIVE DATA")}
          >
            Live {authCounts.live}
          </button>
          <button
            type="button"
            className={authFilter === "AUTH FAILED" ? "appmap-v2-tab active" : "appmap-v2-tab"}
            onClick={() => setAuthFilter("AUTH FAILED")}
          >
            Failed {authCounts.failed}
          </button>
        </div>

        {effectiveAuthInfo?.message ? <div className="appmap-v2-note">Auth: {effectiveAuthInfo.message}</div> : null}

        {(openApiSummary || warnings.length > 0) ? (
          <div className="appmap-v2-note">
            {openApiSummary || warnings[0] || "OpenAPI scan completed."}
            {openApiDiagnostics.length > 0 ? (
              <button
                type="button"
                className="appmap-inline-btn"
                onClick={() => setShowOpenApiDebug((value) => !value)}
              >
                {showOpenApiDebug ? "Hide Debug" : "Show Debug"}
              </button>
            ) : null}
          </div>
        ) : null}

        {showOpenApiDebug && openApiDiagnostics.length > 0 ? (
          <div className="appmap-openapi-debug">
            {openApiDiagnostics.map((entry, index) => (
              <div key={`openapi-diag-${index}`} className="appmap-openapi-debug-item">
                <strong>{entry.endpoint}</strong> - {entry.message}
              </div>
            ))}
          </div>
        ) : null}

        <div className="appmap-v2-tabs" role="tablist" aria-label="App map tabs">
          {viewTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "appmap-v2-tab active" : "appmap-v2-tab"}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!hasProjectContext ? (
          <div className="appmap-v2-warn">
            No project is loaded. Open or import a project from New Project Setup to populate Files, Pages Tree, and API Routes.
          </div>
        ) : null}

        {scanStatus?.lastError ? <div className="appmap-v2-error">{scanStatus.lastError}</div> : null}
      </header>

      <div className="appmap-v2-body">

        {activeTab === "files" ? (
          <main className="appmap-v2-tabpanel">
            <h3>File Paths</h3>
            {sourceMode === "image" ? (
              <div className="appmap-v2-note">
                Imported image mode detected. Attach your local source folder to view real project files.
                <button type="button" className="appmap-inline-btn" onClick={attachSourceFolder}>Attach Source Folder</button>
              </div>
            ) : null}
            {linkedSourcePath ? <div className="appmap-v2-note">Linked source: {linkedSourcePath}</div> : null}
            {packageGroups.length > 1 ? (
              <div className="appmap-package-list">
                {packageGroups.map((pkg) => (
                  <span key={`${pkg.root}-${pkg.manifest}`} className="appmap-package-pill">
                    {pkg.name} ({pkg.manifest || "manifest"})
                  </span>
                ))}
              </div>
            ) : null}

            <div className="appmap-tree-wrap">
              {folderTree ? (
                <TreeNode
                  node={folderTree}
                  depth={0}
                  expandedFolders={expandedFolders}
                  selectedFilePath={selectedFilePath}
                  onToggleFolder={toggleFolder}
                  onSelectFile={selectFile}
                />
              ) : (
                <div className="appmap-v2-empty">No folder tree available.</div>
              )}
            </div>
            {sourceMode === "image" ? (
              <div className="appmap-v2-subblock">
                <h4>Virtual Sources From Runtime</h4>
                {virtualSources.length === 0 ? (
                  <div className="appmap-v2-empty">No source references found.</div>
                ) : (
                  <div className="appmap-virtual-sources">
                    {virtualSources.map(([source, count]) => (
                      <button key={source} type="button" className="appmap-virtual-source" onClick={() => selectFile(source)}>
                        <span>{source}</span>
                        <span>{count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
            {fileFilterPath ? (
              <button type="button" className="appmap-v2-btn" onClick={clearFileFilter}>Clear File Filter</button>
            ) : null}
          </main>
        ) : null}

        {activeTab === "pages" ? (
          <main className="appmap-v2-tabpanel">
            <h3>Pages Tree Graph</h3>
            <div className="appmap-v2-note">
              Parsed from all discovered routes. This graph includes public and auth-protected endpoints.
            </div>
            <div className="appmap-pages-graph">
              <PageGraphNode node={pagesTree} depth={0} />
            </div>
          </main>
        ) : null}

        {activeTab === "api" ? (
          <main className="appmap-v2-tabpanel">
            <h3>API Routes</h3>
            <div className="appmap-v2-note">
              Auth handling: App Map attempts automatic login using configured credentials. You can still apply a token manually to override.
            </div>
            {loading ? <div className="appmap-v2-empty">Loading app map...</div> : null}
            {error ? <div className="appmap-v2-error">{error}</div> : null}
            {!loading && filteredRoutes.length === 0 ? (
              <div className="appmap-v2-empty">
                {hasProjectContext ? "No routes discovered yet. Click Refresh to rescan." : "No project context available."}
              </div>
            ) : null}

            {groupedRoutes.map(([packageName, packageRoutes]) => (
              <section key={packageName} className="appmap-route-group">
                <h4>{packageName}</h4>
                {packageRoutes.map((route) => {
                  const testDraft = routeTests[route.id] || {
                    open: false,
                    loading: false,
                    headersText: "{}",
                    paramsText: "",
                    bodyText: "{}",
                    result: null,
                    error: "",
                  };
                  return (
                    <RouteCard
                      key={route.id}
                      route={route}
                      selected={selectedRouteId === route.id}
                      expanded={Boolean(expandedRoutes[route.id])}
                      testDraft={testDraft}
                      onSelect={() => selectRoute(route.id)}
                      onToggleExpand={() => toggleRouteExpand(route.id)}
                      onToggleTest={() => toggleTestPanel(route.id)}
                      onTestDraftChange={(patch) => updateTestDraft(route.id, patch)}
                      onRunTest={() => runRouteTest(route.id)}
                    />
                  );
                })}
              </section>
            ))}
          </main>
        ) : null}
      </div>
    </section>
  );
}
