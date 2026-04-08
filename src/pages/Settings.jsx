import React from "react";
import { settingsCategories, useSettingsStore } from "../store/settingsStore";

function Switch({ value, onChange }) {
  return (
    <button
      type="button"
      className={value ? "settings-v2-switch on" : "settings-v2-switch"}
      onClick={onChange}
      aria-pressed={value}
    >
      <span className="settings-v2-switch-knob" />
      <span className="settings-v2-switch-text">{value ? "ON" : "OFF"}</span>
    </button>
  );
}

function Row({ label, children }) {
  return (
    <div className="settings-v2-row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

export default function Settings() {
  const {
    activeCategory,
    settings,
    hydrated,
    saveState,
    hydrate,
    setActiveCategory,
    updateSetting,
  } = useSettingsStore();

  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

  React.useEffect(() => {
    document.documentElement.style.setProperty("--font-size-base", settings.fontSize);
  }, [settings.fontSize]);

  if (!hydrated) {
    return <section className="settings-v2-page"><div className="settings-v2-loading">Loading settings...</div></section>;
  }

  return (
    <section className="settings-v2-page">
      <div className="settings-v2-layout">
        <aside className="settings-v2-nav">
          {settingsCategories.map((category) => (
            <button
              key={category}
              className={activeCategory === category ? "active" : ""}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </aside>

        <section className="settings-v2-panel">
          <header>
            <h2>{activeCategory}</h2>
            <span>{saveState}</span>
          </header>

          <div className="settings-v2-content">
            {activeCategory === "General" ? (
              <>
                <Row label="App Theme:">
                  <select value={settings.appTheme} onChange={(event) => updateSetting("appTheme", event.target.value)}>
                    <option value="Dark">Dark</option>
                  </select>
                </Row>
                <Row label="Font Size:">
                  <select value={settings.fontSize} onChange={(event) => updateSetting("fontSize", event.target.value)}>
                    <option value="12px">12px</option>
                    <option value="13px">13px</option>
                    <option value="14px">14px</option>
                  </select>
                </Row>
                <Row label="Log Level:">
                  <select value={settings.logLevel} onChange={(event) => updateSetting("logLevel", event.target.value)}>
                    <option value="info">info</option>
                    <option value="debug">debug</option>
                    <option value="warn">warn</option>
                    <option value="error">error</option>
                  </select>
                </Row>
                <Row label="Auto-open proxy:">
                  <Switch value={settings.autoOpenProxy} onChange={() => updateSetting("autoOpenProxy", !settings.autoOpenProxy)} />
                </Row>
                <Row label="Scan on boot:">
                  <Switch value={settings.scanOnBoot} onChange={() => updateSetting("scanOnBoot", !settings.scanOnBoot)} />
                </Row>
              </>
            ) : null}

            {activeCategory === "Proxy" ? (
              <>
                <Row label="Proxy port:">
                  <input
                    type="number"
                    value={settings.proxyPort}
                    onChange={(event) => updateSetting("proxyPort", Number(event.target.value) || 8080)}
                  />
                </Row>
                <Row label="Intercept by default:">
                  <Switch
                    value={settings.interceptByDefault}
                    onChange={() => updateSetting("interceptByDefault", !settings.interceptByDefault)}
                  />
                </Row>
                <Row label="SSL cert trust:">
                  <select value={settings.sslCertTrust} onChange={(event) => updateSetting("sslCertTrust", event.target.value)}>
                    <option value="Auto install">Auto install</option>
                    <option value="Manual install">Manual install</option>
                    <option value="Do not install">Do not install</option>
                  </select>
                </Row>
              </>
            ) : null}

            {activeCategory === "Scanner" ? (
              <>
                <Row label="Default scan mode:">
                  <select
                    value={settings.defaultScanMode}
                    onChange={(event) => updateSetting("defaultScanMode", event.target.value)}
                  >
                    <option value="Full">Full</option>
                    <option value="Fast">Fast</option>
                  </select>
                </Row>
                <Row label="Payload intensity:">
                  <select
                    value={settings.payloadIntensity}
                    onChange={(event) => updateSetting("payloadIntensity", event.target.value)}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </Row>
                <Row label="Timeout per request:">
                  <input
                    type="number"
                    value={settings.timeoutPerRequest}
                    onChange={(event) => updateSetting("timeoutPerRequest", Number(event.target.value) || 5000)}
                  />
                </Row>
              </>
            ) : null}

            {activeCategory === "Git Gate" ? (
              <>
                <Row label="Block on critical:">
                  <Switch
                    value={settings.gitBlockCritical}
                    onChange={() => updateSetting("gitBlockCritical", !settings.gitBlockCritical)}
                  />
                </Row>
                <Row label="Block on high:">
                  <Switch
                    value={settings.gitBlockHigh}
                    onChange={() => updateSetting("gitBlockHigh", !settings.gitBlockHigh)}
                  />
                </Row>
                <Row label="Block on secrets:">
                  <Switch
                    value={settings.gitBlockSecrets}
                    onChange={() => updateSetting("gitBlockSecrets", !settings.gitBlockSecrets)}
                  />
                </Row>
                <Row label="Max scan duration:">
                  <input
                    value={settings.maxScanDuration}
                    onChange={(event) => updateSetting("maxScanDuration", event.target.value)}
                  />
                </Row>
              </>
            ) : null}

            {activeCategory === "Report" ? (
              <>
                <Row label="Include evidence blocks:">
                  <Switch
                    value={settings.reportIncludeEvidence}
                    onChange={() => updateSetting("reportIncludeEvidence", !settings.reportIncludeEvidence)}
                  />
                </Row>
                <Row label="Default export format:">
                  <select
                    value={settings.reportDefaultFormat}
                    onChange={(event) => updateSetting("reportDefaultFormat", event.target.value)}
                  >
                    <option value="PDF">PDF</option>
                    <option value="Markdown">Markdown</option>
                    <option value="JSON">JSON</option>
                  </select>
                </Row>
                <Row label="Enable AI summary:">
                  <Switch
                    value={settings.reportLlmEnabled}
                    onChange={() => updateSetting("reportLlmEnabled", !settings.reportLlmEnabled)}
                  />
                </Row>
                <Row label="LLM endpoint URL:">
                  <input
                    value={settings.reportLlmEndpoint}
                    placeholder="https://your-ngrok-host/api/generate"
                    onChange={(event) => updateSetting("reportLlmEndpoint", event.target.value)}
                  />
                </Row>
                <Row label="LLM model:">
                  <input
                    value={settings.reportLlmModel}
                    placeholder="qwen2.5:3b"
                    onChange={(event) => updateSetting("reportLlmModel", event.target.value)}
                  />
                </Row>
                <Row label="LLM API key (optional):">
                  <input
                    type="password"
                    value={settings.reportLlmApiKey}
                    placeholder="Optional bearer token"
                    onChange={(event) => updateSetting("reportLlmApiKey", event.target.value)}
                  />
                </Row>
              </>
            ) : null}

            {activeCategory === "Advanced" ? (
              <>
                <Row label="Telemetry:">
                  <Switch
                    value={settings.advancedTelemetry}
                    onChange={() => updateSetting("advancedTelemetry", !settings.advancedTelemetry)}
                  />
                </Row>
                <Row label="Verbose IPC:">
                  <Switch
                    value={settings.advancedVerboseIpc}
                    onChange={() => updateSetting("advancedVerboseIpc", !settings.advancedVerboseIpc)}
                  />
                </Row>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
