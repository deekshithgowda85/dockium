import React from "react";
import { useMapStore } from "../store/mapStore";

const tabs = [
  { id: "folder-tree", label: "Folder Tree" },
  { id: "route-tree", label: "Route Tree" },
  { id: "api-graph", label: "API Graph" },
];

function FolderNode({ node, depth, expandedFolders, onToggle }) {
  const isFolder = node.kind === "folder";
  const expanded = isFolder ? Boolean(expandedFolders[node.id]) : false;

  return (
    <>
      <div
        className={isFolder ? "map-folder-row map-folder-clickable" : "map-folder-row"}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={isFolder ? () => onToggle(node.id) : undefined}
      >
        <span className="map-folder-name">
          {`${"  ".repeat(depth)}${isFolder ? (expanded ? "[-] " : "[+] ") : ""}${node.name}`}
        </span>
        {node.annotation ? (
          <span className="map-annotation-badge">{node.annotation}</span>
        ) : null}
      </div>

      {isFolder && expanded
        ? node.children?.map((child) => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              onToggle={onToggle}
            />
          ))
        : null}
    </>
  );
}

function FolderTreeTab() {
  const folderTree = useMapStore((state) => state.folderTree);
  const expandedFolders = useMapStore((state) => state.expandedFolders);
  const toggleFolder = useMapStore((state) => state.toggleFolder);
  const expandAllFolders = useMapStore((state) => state.expandAllFolders);
  const collapseAllFolders = useMapStore((state) => state.collapseAllFolders);

  if (folderTree.length === 0) {
    return (
      <section className="map-box">
        <header className="map-box-head">Folder Tree</header>
        <div className="map-box-body map-empty-state">No project tree available yet.</div>
      </section>
    );
  }

  return (
    <section className="map-box">
      <header className="map-box-head map-head-actions">
        <span>Folder Tree</span>
        <div className="map-inline-actions">
          <button type="button" className="map-action-btn" onClick={expandAllFolders}>Expand All</button>
          <button type="button" className="map-action-btn" onClick={collapseAllFolders}>Collapse All</button>
        </div>
      </header>
      <div className="map-box-body map-folder-body">
        {folderTree.map((node) => (
          <FolderNode
            key={node.id}
            node={node}
            depth={0}
            expandedFolders={expandedFolders}
            onToggle={toggleFolder}
          />
        ))}
      </div>
    </section>
  );
}

function RouteTreeTab() {
  const routes = useMapStore((state) => state.routes);
  const searchQuery = useMapStore((state) => state.searchQuery);
  const methodFilter = useMapStore((state) => state.methodFilter);
  const expandedRouteId = useMapStore((state) => state.expandedRouteId);
  const toggleRouteDetails = useMapStore((state) => state.toggleRouteDetails);

  const filteredRoutes = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return routes.filter((route) => {
      const methodOk = methodFilter === "ALL" || route.method === methodFilter;
      if (!methodOk) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = `${route.method} ${route.path} ${route.sourceFile}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [methodFilter, routes, searchQuery]);

  if (routes.length === 0) {
    return (
      <section className="map-box">
        <header className="map-box-head">Route Tree</header>
        <div className="map-box-body map-empty-state">No routes discovered. Open a project from onboarding first.</div>
      </section>
    );
  }

  return (
    <section className="map-box">
      <header className="map-box-head">Route Tree ({filteredRoutes.length})</header>
      <div className="map-box-body map-route-body">
        <table className="map-route-table">
          <thead>
            <tr>
              <th>METHOD</th>
              <th>PATH</th>
              <th>AUTH</th>
              <th>PARAMS</th>
              <th>SOURCE FILE</th>
            </tr>
          </thead>
          <tbody>
            {filteredRoutes.map((route, index) => {
              const expanded = expandedRouteId === route.id;
              const riskPost = route.method === "POST";
              return (
                <React.Fragment key={route.id}>
                  <tr
                    className={index % 2 === 1 ? "map-route-row alt" : "map-route-row"}
                    onClick={() => toggleRouteDetails(route.id)}
                  >
                    <td className={riskPost ? "map-method-risk" : ""}>{route.method}</td>
                    <td>{route.path}</td>
                    <td>{route.auth ? "⛨" : "-"}</td>
                    <td>{route.params}</td>
                    <td>{route.sourceFile}</td>
                  </tr>
                  {expanded ? (
                    <tr className="map-route-detail-row">
                      <td colSpan={5}>
                        <div className="map-route-detail-panel">
                          <div>
                            <label>Expected request shape</label>
                            <pre>{route.requestShape}</pre>
                          </div>
                          <div>
                            <label>Expected response shape</label>
                            <pre>{route.responseShape}</pre>
                          </div>
                          <div>
                            <label>Auth requirements</label>
                            <p>{route.authRequirements}</p>
                          </div>
                          <div>
                            <label>Related test payloads</label>
                            <ul>
                              {route.testPayloads.map((payload) => (
                                <li key={`${route.id}-${payload}`}>{payload}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
            {filteredRoutes.length === 0 ? (
              <tr>
                <td className="map-empty-cell" colSpan={5}>No routes match current search/filter.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ApiGraphTab() {
  const apiFlows = useMapStore((state) => state.apiFlows);
  const authBoundaries = useMapStore((state) => state.authBoundaries);
  const searchQuery = useMapStore((state) => state.searchQuery);
  const methodFilter = useMapStore((state) => state.methodFilter);
  const selectedEndpointId = useMapStore((state) => state.selectedEndpointId);
  const selectEndpoint = useMapStore((state) => state.selectEndpoint);

  const filteredFlows = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return apiFlows.filter((flow) => {
      const methodOk = methodFilter === "ALL" || String(flow.method || "").toUpperCase() === methodFilter;
      if (!methodOk) {
        return false;
      }

      if (!query) {
        return true;
      }

      return `${flow.method} ${flow.path}`.toLowerCase().includes(query);
    });
  }, [apiFlows, methodFilter, searchQuery]);

  const selectedFlow =
    filteredFlows.find((flow) => flow.id === selectedEndpointId) ?? filteredFlows[0] ?? null;

  if (apiFlows.length === 0) {
    return (
      <section className="map-box">
        <header className="map-box-head">API Graph</header>
        <div className="map-box-body map-empty-state">No API flow data available yet.</div>
      </section>
    );
  }

  const boundary = authBoundaries.find((item) => item.path === selectedFlow?.path) || null;

  return (
    <section className="map-box">
      <header className="map-box-head">API Graph ({filteredFlows.length})</header>
      <div className="map-box-body map-graph-layout">
        <div className="map-endpoint-list">
          {filteredFlows.map((flow) => (
            <button
              key={flow.id}
              type="button"
              className={
                flow.id === selectedFlow?.id
                  ? "map-endpoint-item active"
                  : "map-endpoint-item"
              }
              onClick={() => selectEndpoint(flow.id)}
            >
              <span className={flow.method === "POST" ? "map-method-risk" : ""}>{flow.method}</span>
              <span>{flow.path}</span>
            </button>
          ))}
          {filteredFlows.length === 0 ? (
            <div className="map-endpoint-empty">No endpoints match current search/filter.</div>
          ) : null}
        </div>

        <div className="map-endpoint-detail">
          {selectedFlow ? (
            <div className="map-endpoint-detail-stack">
              <div>
                <label>Call Chain</label>
                <pre>{selectedFlow.chain.join("\n")}</pre>
              </div>
              <div>
                <label>Request Schema</label>
                <pre>{JSON.stringify(selectedFlow.requestSchema || {}, null, 2)}</pre>
              </div>
              <div>
                <label>Response Schema</label>
                <pre>{JSON.stringify(selectedFlow.responseSchema || {}, null, 2)}</pre>
              </div>
              <div>
                <label>Auth Boundary</label>
                <pre>{boundary ? JSON.stringify(boundary, null, 2) : "No boundary data"}</pre>
              </div>
            </div>
          ) : (
            <pre>No endpoint selected</pre>
          )}
        </div>
      </div>
    </section>
  );
}

export default function AppMap() {
  const activeTab = useMapStore((state) => state.activeTab);
  const loading = useMapStore((state) => state.loading);
  const error = useMapStore((state) => state.error);
  const routes = useMapStore((state) => state.routes);
  const folderTree = useMapStore((state) => state.folderTree);
  const apiFlows = useMapStore((state) => state.apiFlows);
  const searchQuery = useMapStore((state) => state.searchQuery);
  const methodFilter = useMapStore((state) => state.methodFilter);
  const setActiveTab = useMapStore((state) => state.setActiveTab);
  const setSearchQuery = useMapStore((state) => state.setSearchQuery);
  const setMethodFilter = useMapStore((state) => state.setMethodFilter);
  const hydrate = useMapStore((state) => state.hydrate);

  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

  const folderCount = React.useMemo(() => {
    const walk = (nodes) => nodes.reduce((acc, node) => {
      const childCount = walk(node.children || []);
      return acc + (node.kind === "folder" ? 1 : 0) + childCount;
    }, 0);
    return walk(folderTree);
  }, [folderTree]);

  return (
    <section className="appmap-page">
      <header className="appmap-header">
        <div className="appmap-title-row">
          <h2>Application Map</h2>
          <span>folder, route, and API data flow mapping</span>
        </div>
        <div className="appmap-toolbar">
          <input
            className="appmap-search"
            placeholder="Search path, method, source file"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
            <option value="ALL">ALL METHODS</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
          <button type="button" className="appmap-refresh" onClick={hydrate}>Refresh</button>
        </div>
        <div className="appmap-summary">
          <span>Folders: {folderCount}</span>
          <span>Routes: {routes.length}</span>
          <span>API Flows: {apiFlows.length}</span>
        </div>
        <div className="appmap-subtabs" role="tablist" aria-label="App map tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "appmap-tab active" : "appmap-tab"}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <div className="appmap-body">
        {loading ? <div className="map-loading">Loading map data...</div> : null}
        {error ? <div className="map-error">{error}</div> : null}
        {activeTab === "folder-tree" ? <FolderTreeTab /> : null}
        {activeTab === "route-tree" ? <RouteTreeTab /> : null}
        {activeTab === "api-graph" ? <ApiGraphTab /> : null}
      </div>
    </section>
  );
}
