import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import DockiumLogo from "./DockiumLogo";
import { useUiStore } from "../store/uiStore";
import { useContainerStore } from "../store/containerStore";

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_ICON_WIDTH = 68;

const menuItems = ["File", "Edit", "Selection", "View", "Go", "Run", "Terminal", "Help"];

const menuActions = {
  File: [
    { label: "New Project Setup", action: "newProject" },
    { label: "Dashboard", action: "dashboard" },
    { label: "Exit Dockium", action: "closeWindow" },
  ],
  Edit: [
    { label: "Run Full Scan", action: "fullScan" },
    { label: "Quick Scan", action: "quickScan" },
  ],
  Selection: [
    { label: "Proxy View", action: "proxy" },
    { label: "Scanner", action: "scanner" },
  ],
  View: [
    { label: "Toggle Sidebar", action: "toggleSidebar" },
    { label: "App Map", action: "appMap" },
    { label: "Active Scan", action: "activeScan" },
    { label: "Settings", action: "settings" },
  ],
  Go: [
    { label: "Dashboard", action: "dashboard" },
    { label: "Report", action: "report" },
    { label: "Git Gate", action: "gitGate" },
  ],
  Run: [
    { label: "Run Full Scan", action: "fullScan" },
    { label: "Open Scanner", action: "scanner" },
  ],
  Terminal: [
    { label: "Toggle Proxy", action: "toggleProxy" },
    { label: "Open Proxy", action: "proxy" },
  ],
  Help: [
    { label: "About Dockium", action: "about" },
  ],
};

const navSections = [
  {
    label: "Workspace",
    items: [
      { path: "/dashboard", label: "Dashboard", icon: "dashboard", badge: "LIVE", badgeType: "green" },
      { path: "/new-project", label: "New Project", icon: "newProject" },
    ],
  },
  {
    label: "Analysis",
    items: [
      { path: "/app-map", label: "App Map", icon: "appMap", badge: "12", badgeType: "orange" },
      { path: "/proxy", label: "Proxy", icon: "proxy", badge: "312", badgeType: "gray" },
      { path: "/scanner", label: "Scanner", icon: "scanner", badge: "18", badgeType: "red" },
      { path: "/active-scan", label: "Active Scan", icon: "shield", badge: "ACT", badgeType: "orange" },
      { path: "/secrets", label: "Secrets", icon: "secrets", badge: "7", badgeType: "red" },
      { path: "/cve-scanner", label: "CVE Scanner", icon: "shield", badge: "3", badgeType: "orange" },
    ],
  },
  {
    label: "Workflow",
    items: [
      { path: "/git-gate", label: "Git Gate", icon: "gitGate", badge: "Blocked", badgeType: "red" },
      { path: "/report", label: "Report", icon: "report" },
      { path: "/snapshots", label: "Snapshots", icon: "snapshots", badge: "4", badgeType: "gray" },
      { path: "/settings", label: "Settings", icon: "settings" },
    ],
  },
];

function NavIcon({ name }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  const icons = {
    dashboard: <path d="M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" />,
    newProject: <path d="M12 5v14M5 12h14" />,
    appMap: <path d="M4 4h6v6H4zM14 4h6v6h-6zM9 10v4M15 10v4M4 14h6v6H4zM14 14h6v6h-6z" />,
    proxy: <path d="M7 7h10v10H7zM3 12h4M17 12h4M12 3v4M12 17v4" />,
    scanner: <path d="M10 10h4v4h-4zM3 12h4M17 12h4M12 3v4M12 17v4M5 5l3 3M16 16l3 3" />,
    secrets: <path d="M8 11V8a4 4 0 1 1 8 0v3M6 11h12v10H6zM12 15v2" />,
    shield: <path d="M12 3l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z" />,
    gitGate: <path d="M7 7h4v4H7zM13 13h4v4h-4zM11 9h2v6h-2" />,
    report: <path d="M7 3h8l4 4v14H7zM15 3v4h4M9 12h6M9 16h6" />,
    snapshots: <path d="M4 8h16v12H4zM8 8l2-3h4l2 3M12 13a2 2 0 1 0 0 4" />,
    settings: <path d="M12 8a4 4 0 1 1 0 8a4 4 0 0 1 0-8zm0-5v3m0 12v3M4.9 4.9l2.1 2.1m9.9 9.9l2.1 2.1M3 12h3m12 0h3M4.9 19.1l2.1-2.1m9.9-9.9l2.1-2.1" />,
  };

  return <svg {...common}>{icons[name] || icons.dashboard}</svg>;
}

function NavEntry({ item, compact }) {
  return (
    <NavLink
      to={item.path}
      title={item.label}
      className={({ isActive }) => {
        const classes = ["nav-item", compact ? "compact" : "", isActive ? "active" : ""];
        return classes.filter(Boolean).join(" ");
      }}
    >
      <span className="nav-icon"><NavIcon name={item.icon} /></span>
      {!compact ? <span className="nav-label">{item.label}</span> : null}
      {!compact && item.badge ? <span className={`badge ${item.badgeType}`}>{item.badge}</span> : null}
    </NavLink>
  );
}

function Sidebar({ compact }) {
  const containers = useContainerStore((state) => state.containers);
  const runningContainers = containers.filter((container) => container.status === "RUNNING");
  const runningCount = runningContainers.length;
  const totalCount = containers.length;

  return (
    <aside className={compact ? "sidebar compact" : "sidebar"}>
      {navSections.map((section) => (
        <div key={section.label}>
          {!compact ? <div className="section-label">{section.label}</div> : null}
          {section.items.map((item) => (
            <NavEntry key={item.path} item={item} compact={compact} />
          ))}
        </div>
      ))}

      {!compact ? (
        <div className="docker-box">
          <div className="docker-head">
            <strong>Docker Runtime</strong>
            <span className="badge green">{runningCount} running</span>
          </div>
          <div className="docker-current">
            <span>Current Running</span>
            <strong>{runningCount}/{totalCount}</strong>
          </div>
          <div className="docker-running-list">
            {runningContainers.length > 0
              ? runningContainers.map((container) => (
                  <span key={`running-${container.name}`} className="docker-running-chip">
                    {container.name}
                  </span>
                ))
              : <span className="docker-running-empty">No running containers</span>}
          </div>
          <div className="docker-list">
            {containers.map((container) => (
              <div className="docker-item" key={container.name}>
                <div className="docker-top">
                  <span className="docker-name">{container.name}</span>
                  <span className="docker-state">{String(container.status || "STOPPED").toLowerCase()}</span>
                </div>
                <div className="docker-meta">
                  <span>Port {container.port || "--"}</span>
                  <span>CPU {container.cpu || "0.0%"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const {
    proxyOn,
    scanMode,
    toggleProxy,
    setScanMode,
    initialization,
    toasts,
    removeToast,
  } = useUiStore();
  const hydrateContainers = useContainerStore((state) => state.hydrate);
  const [isMaximized, setIsMaximized] = React.useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
  const [sidebarWidth, setSidebarWidth] = React.useState(280);
  const [openMenu, setOpenMenu] = React.useState("");
  const dragRef = React.useRef(null);
  const menuRef = React.useRef(null);

  const currentSidebarWidth = isSidebarCollapsed ? SIDEBAR_ICON_WIDTH : sidebarWidth;

  React.useEffect(() => {
    hydrateContainers();
    window.dockium?.proxy?.getStatus?.().then((status) => {
      if (status?.ok) {
        useUiStore.setState({ proxyOn: Boolean(status.status?.running) });
      }
    });

    const pollId = window.setInterval(() => {
      hydrateContainers();
    }, 5000);

    return () => {
      window.clearInterval(pollId);
    };
  }, [hydrateContainers]);

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
    const onWindowClick = (event) => {
      if (!menuRef.current) {
        return;
      }

      if (!menuRef.current.contains(event.target)) {
        setOpenMenu("");
      }
    };

    window.addEventListener("mousedown", onWindowClick);
    return () => {
      window.removeEventListener("mousedown", onWindowClick);
    };
  }, []);

  React.useEffect(() => {
    const onSidebarEvent = (event) => {
      const requested = event?.detail?.collapsed;
      if (typeof requested === "boolean") {
        setIsSidebarCollapsed(requested);
        return;
      }
      setIsSidebarCollapsed((current) => !current);
    };

    window.addEventListener("dockium:sidebar:set", onSidebarEvent);
    return () => {
      window.removeEventListener("dockium:sidebar:set", onSidebarEvent);
    };
  }, []);

  React.useEffect(() => {
    const unsubscribe = window.dockium?.menu?.onNavigate?.((payload) => {
      const path = typeof payload?.path === "string" ? payload.path : "";
      if (path) {
        navigate(path);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  React.useEffect(() => {
    const onMouseMove = (event) => {
      if (!dragRef.current) {
        return;
      }

      const nextWidth = dragRef.current.startWidth + (event.clientX - dragRef.current.startX);
      const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, nextWidth));
      setSidebarWidth(clamped);
    };

    const onMouseUp = () => {
      dragRef.current = null;
      document.body.classList.remove("is-resizing-sidebar");
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("is-resizing-sidebar");
    };
  }, []);

  const beginSidebarResize = (event) => {
    if (isSidebarCollapsed) {
      return;
    }

    dragRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    };

    document.body.classList.add("is-resizing-sidebar");
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed((current) => !current);
  };

  const handleMenuAction = (action) => {
    switch (action) {
      case "newProject":
        navigate("/new-project");
        break;
      case "dashboard":
        navigate("/dashboard");
        break;
      case "proxy":
        navigate("/proxy");
        break;
      case "scanner":
        navigate("/scanner");
        break;
      case "activeScan":
        navigate("/active-scan");
        break;
      case "appMap":
        navigate("/app-map");
        break;
      case "settings":
        navigate("/settings");
        break;
      case "report":
        navigate("/report");
        break;
      case "gitGate":
        navigate("/git-gate");
        break;
      case "fullScan":
        setScanMode("Full Scan");
        break;
      case "quickScan":
        setScanMode("Quick Scan");
        break;
      case "toggleProxy":
        toggleProxy();
        break;
      case "toggleSidebar":
        toggleSidebar();
        break;
      case "closeWindow":
        window.dockium?.window?.close?.();
        break;
      case "about":
        useUiStore.getState().addToast({
          type: "info",
          title: "Dockium",
          message: "Security Workbench local desktop edition.",
        });
        break;
      default:
        break;
    }

    setOpenMenu("");
  };

  return (
    <div className="app" style={{ "--sidebar-current-width": `${currentSidebarWidth}px` }}>
      <div
        className="window-titlebar"
        onDoubleClick={() => {
          window.dockium?.window?.toggleMaximize?.();
        }}
      >
        <div className="titlebar-left no-drag" ref={menuRef}>
          <button className="sidebar-toggle-btn" onClick={toggleSidebar} title="Toggle sidebar">
            {isSidebarCollapsed ? ">" : "<"}
          </button>
          <DockiumLogo className="titlebar-logo" />
          <div className="window-menu">
            {menuItems.map((item) => (
              <div key={item} className="window-menu-wrap">
                <button
                  type="button"
                  className={openMenu === item ? "window-menu-item active" : "window-menu-item"}
                  onClick={() => setOpenMenu((current) => (current === item ? "" : item))}
                >
                  {item}
                </button>
                {openMenu === item ? (
                  <div className="window-menu-dropdown">
                    {(menuActions[item] || []).map((entry) => (
                      <button
                        key={`${item}-${entry.label}`}
                        type="button"
                        className="window-menu-dropdown-item"
                        onClick={() => handleMenuAction(entry.action)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="titlebar-center no-drag">
          <div className="search">
            <span>Search</span>
            <input placeholder="Find routes, findings, CVEs, commits..." readOnly />
            <span className="mono-help">Ctrl+K</span>
          </div>
          <div className="titlebar-scan-actions">
            <button className="btn primary" onClick={() => setScanMode("Full Scan")}>Run Scan</button>
            <button className="btn" onClick={() => setScanMode("Quick Scan")}>Quick Scan</button>
          </div>
        </div>
        <div className="titlebar-right no-drag">
          <div className="titlebar-meta">
            <span className="window-title">Dockium</span>
            <span className="local-chip">LOCAL MODE</span>
          </div>
          <div className="window-controls no-drag">
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
      </div>

      <div className="layout">
        <Sidebar compact={isSidebarCollapsed} />
        <div
          className={isSidebarCollapsed ? "sidebar-resizer disabled" : "sidebar-resizer"}
          onMouseDown={beginSidebarResize}
          title={isSidebarCollapsed ? "Expand sidebar to resize" : "Resize sidebar"}
        />
        <main className="main">
          <Outlet />
        </main>
      </div>

      <div className="statusbar">
        <span>
          Init: {initialization.active ? initialization.message || "Running in background" : "Ready"}
          {initialization.active ? ` | AI ${initialization.needsAi ? "Required" : "Optional"}` : ""}
        </span>
        <span>Mode: {scanMode}</span>
        <button className="status-toggle" onClick={toggleProxy}>
          Proxy {proxyOn ? "ON" : "OFF"}
        </button>
        <span>Mem 378 MB</span>
      </div>

      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <div className="toast-copy">
              <strong>{toast.title}</strong>
              <span>{toast.message}</span>
            </div>
            <button
              className="toast-close"
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss notification"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
