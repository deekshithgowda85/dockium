import React from "react";
import { useProxyStore } from "../store/proxyStore";

function parseRawSections(rawText) {
  const sections = rawText.split(/\r?\n\r?\n/);
  return {
    headers: sections[0] ?? "",
    body: sections.slice(1).join("\n\n") || "",
  };
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function formatEpoch(epoch) {
  if (typeof epoch !== "number") {
    return "n/a";
  }

  const time = new Date(epoch * 1000);
  if (Number.isNaN(time.getTime())) {
    return "n/a";
  }

  const pad = (num) => String(num).padStart(2, "0");
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(
    time.getHours(),
  )}:${pad(time.getMinutes())}`;
}

function extractJwt(rawText) {
  const pattern = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
  const token = rawText.match(pattern)?.[0];
  if (!token) {
    return null;
  }

  const [headerSegment, payloadSegment] = token.split(".");
  const header = decodeBase64Url(headerSegment);
  const payload = decodeBase64Url(payloadSegment);

  return {
    token,
    header,
    payload,
  };
}

function useHorizontalResize(layoutRef, value, onChange) {
  function onMouseDown(event) {
    event.preventDefault();

    function onMove(moveEvent) {
      const bounds = layoutRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      const ratio = ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
      onChange(Math.min(75, Math.max(24, ratio)));
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    }

    document.body.style.cursor = "row-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return {
    onMouseDown,
    value,
  };
}

function useVerticalResize(layoutRef, value, onChange) {
  function onMouseDown(event) {
    event.preventDefault();

    function onMove(moveEvent) {
      const bounds = layoutRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      const ratio = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      onChange(Math.min(72, Math.max(28, ratio)));
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    }

    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return {
    onMouseDown,
    value,
  };
}

export default function ProxyView() {
  const {
    proxyEnabled,
    interceptEnabled,
    filterText,
    requests,
    selectedRequestId,
    hydrate,
    setFilterText,
    toggleProxyEnabled,
    toggleInterceptEnabled,
    clearRequests,
    selectRequest,
    updateSelectedRequestRaw,
    replaySelectedRequest,
    forwardSelected,
    dropSelected,
  } = useProxyStore();

  const [topPercent, setTopPercent] = React.useState(40);
  const [leftPercent, setLeftPercent] = React.useState(50);

  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

  const fullPanelRef = React.useRef(null);
  const bottomPanelRef = React.useRef(null);

  const horizontalResize = useHorizontalResize(fullPanelRef, topPercent, setTopPercent);
  const verticalResize = useVerticalResize(bottomPanelRef, leftPercent, setLeftPercent);

  const filteredRequests = React.useMemo(() => {
    const query = filterText.trim().toLowerCase();
    if (!query) {
      return requests;
    }

    return requests.filter((request) => request.path.toLowerCase().includes(query));
  }, [filterText, requests]);

  const selectedRequest = React.useMemo(
    () => requests.find((request) => request.id === selectedRequestId) ?? null,
    [requests, selectedRequestId],
  );

  React.useEffect(() => {
    if (filteredRequests.length === 0) {
      return;
    }

    const exists = filteredRequests.some((request) => request.id === selectedRequestId);
    if (!exists) {
      selectRequest(filteredRequests[0].id);
    }
  }, [filteredRequests, selectRequest, selectedRequestId]);

  const requestSections = parseRawSections(selectedRequest?.requestRaw ?? "");
  const responseSections = parseRawSections(selectedRequest?.responseRaw ?? "");
  const jwt = extractJwt(selectedRequest?.responseRaw ?? "");
  const layoutRows = `${horizontalResize.value}% 6px ${100 - horizontalResize.value}%`;
  const layoutColumns = `${verticalResize.value}% 6px ${100 - verticalResize.value}%`;

  return (
    <section className="proxy-view">
      <header className="proxy-toolbar">
        <button className="proxy-btn" onClick={toggleProxyEnabled}>
          Proxy: {proxyEnabled ? "ON" : "OFF"}
        </button>
        <button className="proxy-btn" onClick={clearRequests}>Clear</button>

        <label className="proxy-filter">
          <span>Filter:</span>
          <input
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="/api/auth"
          />
        </label>

        <button className="proxy-btn" onClick={toggleInterceptEnabled}>
          Intercept: {interceptEnabled ? "ON" : "OFF"}
        </button>
        <button className="proxy-btn" onClick={forwardSelected}>Forward</button>
        <button className="proxy-btn" onClick={dropSelected}>Drop</button>
      </header>

      <div className="proxy-layout" ref={fullPanelRef} style={{ gridTemplateRows: layoutRows }}>
        <section className="proxy-panel">
          <div className="proxy-panel-label">Request List</div>
          <div className="proxy-request-list-wrap">
            <table className="proxy-request-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>METHOD</th>
                  <th>HOST</th>
                  <th>PATH</th>
                  <th>STATUS</th>
                  <th>TIME</th>
                  <th>FLAG</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((request) => {
                  const selected = selectedRequest?.id === request.id;
                  const flagClass =
                    request.flag === "FINDING"
                      ? "proxy-flag-finding"
                      : request.flag === "SUSPICIOUS"
                        ? "proxy-flag-suspicious"
                        : "";
                  return (
                    <tr
                      key={request.id}
                      className={selected ? "selected" : ""}
                      onClick={() => selectRequest(request.id)}
                    >
                      <td>{request.id}</td>
                      <td>{request.method}</td>
                      <td>{request.host}</td>
                      <td>{request.path}</td>
                      <td>{request.status}</td>
                      <td>{request.timeMs}ms</td>
                      <td className={flagClass}>{request.flag}</td>
                    </tr>
                  );
                })}
                {filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="proxy-empty-cell">
                      No requests matched the filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <div className="proxy-resizer horizontal" onMouseDown={horizontalResize.onMouseDown} />

        <section
          className="proxy-bottom-layout"
          style={{ gridTemplateColumns: layoutColumns }}
          ref={bottomPanelRef}
        >
          <section className="proxy-panel request-editor-panel">
            <div className="proxy-panel-label">Request (raw, editable)</div>
            <div className="proxy-raw-preview">
              <pre>
                <span className="proxy-raw-headers">{requestSections.headers}</span>
                {requestSections.body ? "\n\n" : ""}
                <span className="proxy-raw-body">{requestSections.body}</span>
              </pre>
            </div>
            <textarea
              className="proxy-request-editor"
              value={selectedRequest?.requestRaw ?? ""}
              onChange={(event) => updateSelectedRequestRaw(event.target.value)}
            />
            <div className="proxy-panel-actions">
              <button className="proxy-btn" onClick={replaySelectedRequest}>Replay</button>
              <button className="proxy-btn">Save</button>
            </div>
          </section>

          <div className="proxy-resizer vertical" onMouseDown={verticalResize.onMouseDown} />

          <section className="proxy-panel response-panel">
            <div className="proxy-panel-label">Response (raw, read-only)</div>
            <pre className="proxy-response-view">
              <span className="proxy-raw-headers">{responseSections.headers}</span>
              {responseSections.body ? "\n\n" : ""}
              <span className="proxy-raw-body">{responseSections.body}</span>
            </pre>
            <div className="proxy-panel-actions">
              <button
                className="proxy-btn"
                onClick={() => navigator.clipboard.writeText(selectedRequest?.responseRaw ?? "")}
              >
                Copy
              </button>
            </div>

            {jwt ? (
              <section className="proxy-jwt-panel">
                <div className="proxy-panel-label">JWT Decoded</div>
                <pre>
                  Header: {JSON.stringify(jwt.header ?? {}, null, 2)}{"\n"}
                  Payload: {JSON.stringify(jwt.payload ?? {}, null, 2)}{"\n"}
                  {jwt.payload?.exp ? `exp human: ${formatEpoch(jwt.payload.exp)}\n` : ""}
                  Signature: [UNVERIFIED]
                </pre>
              </section>
            ) : null}
          </section>
        </section>
      </div>
    </section>
  );
}
