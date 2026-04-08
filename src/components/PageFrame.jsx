import React from "react";
import { useDummyPageApi } from "../hooks/useDummyPageApi";

function toPageKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function PageFrame({
  crumb,
  title,
  description,
  actions,
  headerExtra,
  children,
  pageKey,
}) {
  const resolvedPageKey = pageKey ?? toPageKey(title);
  const { isLoading, lastLoadedLabel, refresh } = useDummyPageApi(resolvedPageKey);

  return (
    <section className="page active">
      <div className="page-header">
        <div className="crumb">{crumb}</div>
        <div className="head-row">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <div className="head-actions">
            {actions}
            <button className="btn" type="button" onClick={refresh}>
              Refresh Data
            </button>
          </div>
        </div>
        <div className="api-state-row">
          <span className={isLoading ? "api-state loading" : "api-state"}>
            {isLoading ? "Fetching page data..." : `Last update ${lastLoadedLabel}`}
          </span>
        </div>
        {headerExtra ? <div>{headerExtra}</div> : null}
      </div>
      <div className="page-body">
        {isLoading ? (
          <div className="loading-shell" role="status" aria-live="polite">
            <div className="loading-row" />
            <div className="loading-row wide" />
            <div className="loading-grid">
              <div className="loading-card" />
              <div className="loading-card" />
              <div className="loading-card" />
            </div>
            <div className="loading-row" />
            <div className="loading-row mid" />
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
