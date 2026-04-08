function registerDockerIpc(ipcMain, deps) {
  const { getProjectConfig, getContainerManager, getWss, getRecentImports, setRecentImports } = deps;

  const normalizeImportUrl = (url) => {
    const raw = String(url || "").trim();
    if (!raw) {
      return "";
    }

    const stripped = raw.replace(/^docker:\/\//i, "");
    const candidate = /^https?:\/\//i.test(stripped)
      ? stripped
      : /^hub\.docker\.com\//i.test(stripped)
        ? `https://${stripped}`
        : stripped;

    if (!/^https?:\/\//i.test(candidate)) {
      return stripped;
    }

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
      if (!namespace || !image) {
        return "";
      }

      const tag = parsed.searchParams.get("tag") || "latest";
      return `${namespace}/${image}:${tag}`;
    } catch {
      return "";
    }
  };

  ipcMain.handle("docker:startAll", async () => {
    const config = getProjectConfig();
    if (!config) {
      return { ok: false, error: "No project loaded" };
    }

    const manager = getContainerManager();
    const result = await manager.startAll(config);
    getWss()?.emitLog("Containers started");
    return { ok: true, result };
  });

  ipcMain.handle("docker:stopAll", async () => {
    const manager = getContainerManager();
    await manager.stopAll();
    getWss()?.emitLog("Containers stopped");
    return { ok: true };
  });

  ipcMain.handle("docker:getStats", async () => {
    const manager = getContainerManager();
    const stats = await manager.getStats();
    return { ok: true, stats };
  });

  ipcMain.handle("docker:getStatus", async () => {
    const manager = getContainerManager();
    const raw = typeof manager.getStatus === "function" ? await manager.getStatus() : await manager.getStats();
    const containers = raw.map((item) => ({
      name: item.name,
      status: item.status,
      cpuPercent: item.cpuPercent ?? item.cpu ?? 0,
      memMB: item.memMB ?? 0,
      ports: item.ports || [],
      health: item.health || "unknown",
    }));

    return { ok: true, containers };
  });

  ipcMain.handle("docker:importByUrl", async (_event, payload = {}) => {
    try {
      const normalized = normalizeImportUrl(payload.url);
      if (!normalized) {
        return {
          ok: false,
          error: "Invalid Docker image reference. Use image:tag or a Docker Hub repository URL.",
        };
      }

      const manager = getContainerManager();
      if (typeof manager.importContainerByUrl !== "function") {
        return { ok: false, error: "Container import is not available" };
      }

      const imported = await manager.importContainerByUrl(normalized);
      const now = Date.now();
      const previous = Array.isArray(getRecentImports?.()) ? getRecentImports() : [];
      const next = [
        { url: normalized, importedAt: now, size: imported?.size ?? null },
        ...previous.filter((entry) => entry.url !== normalized),
      ].slice(0, 8);

      setRecentImports?.(next);
      getWss()?.emitLog(`Imported container image ${normalized}`);

      return {
        ok: true,
        image: imported?.image || normalized,
        size: imported?.size ?? null,
        tags: imported?.tags ?? [],
        recent: next,
      };
    } catch (error) {
      const message = String(error?.message || "Docker import failed");
      const dockerUnavailable = /docker_engine|ecconnrefused|enoent|socket|connect/i.test(message);
      return {
        ok: false,
        error: dockerUnavailable
          ? "Docker daemon is not reachable. Start Docker Desktop and retry import."
          : message,
      };
    }
  });

  ipcMain.handle("docker:getRecentImports", async () => {
    const recent = Array.isArray(getRecentImports?.()) ? getRecentImports() : [];
    return { ok: true, recent };
  });
}

module.exports = { registerDockerIpc };
