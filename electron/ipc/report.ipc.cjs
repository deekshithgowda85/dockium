const fs = require("node:fs/promises");

function defaultExportName(extension) {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `dockium-report-${stamp}.${extension}`;
}

function registerReportIpc(ipcMain, BrowserWindow, dialog, deps) {
  const getReport = () => deps.getLatestReport() || null;
  const getReportContext = async () => {
    if (typeof deps.getReportContext !== "function") {
      return null;
    }
    return await deps.getReportContext();
  };
  const exporters = deps.exporters || {};

  ipcMain.handle("report:getLatest", async () => {
    return { ok: true, report: getReport() };
  });

  ipcMain.handle("report:getContext", async () => {
    const context = await getReportContext();
    return { ok: true, context };
  });

  ipcMain.handle("report:generateSummary", async (_event, payload = {}) => {
    if (typeof deps.generateLlmSummary !== "function") {
      return {
        ok: false,
        error: "LLM summary integration is not configured",
        code: 503,
        detail: "report:generateSummary handler unavailable",
      };
    }

    return await deps.generateLlmSummary(payload);
  });

  ipcMain.handle("report:exportPdf", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { ok: false, error: "No active window for export" };
    }

    const save = await dialog.showSaveDialog(senderWindow, {
      title: "Export Security Report (PDF)",
      defaultPath: defaultExportName("pdf"),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (save.canceled || !save.filePath) {
      return { ok: false, canceled: true };
    }

    const report = getReport();
    if (!report) {
      return { ok: false, error: "No report available" };
    }

    const PdfExporter = exporters.pdf;
    if (PdfExporter) {
      const exporter = new PdfExporter();
      await exporter.export(report, save.filePath);
    } else {
      const pdfBuffer = await senderWindow.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
      await fs.writeFile(save.filePath, pdfBuffer);
    }

    return { ok: true, filePath: save.filePath };
  });

  ipcMain.handle("report:exportMarkdown", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { ok: false, error: "No active window for export" };
    }

    const report = getReport();
    if (!report) {
      return { ok: false, error: "No report available" };
    }

    const save = await dialog.showSaveDialog(senderWindow, {
      title: "Export Security Report (Markdown)",
      defaultPath: defaultExportName("md"),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });

    if (save.canceled || !save.filePath) {
      return { ok: false, canceled: true };
    }

    const MarkdownExporter = exporters.markdown;
    if (MarkdownExporter) {
      const exporter = new MarkdownExporter();
      await exporter.export(report, save.filePath);
    } else {
      await fs.writeFile(save.filePath, JSON.stringify(report, null, 2), "utf8");
    }

    return { ok: true, filePath: save.filePath };
  });

  ipcMain.handle("report:exportJson", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { ok: false, error: "No active window for export" };
    }

    const report = getReport();
    if (!report) {
      return { ok: false, error: "No report available" };
    }

    const save = await dialog.showSaveDialog(senderWindow, {
      title: "Export Security Report (JSON)",
      defaultPath: defaultExportName("json"),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (save.canceled || !save.filePath) {
      return { ok: false, canceled: true };
    }

    const JsonExporter = exporters.json;
    if (JsonExporter) {
      const exporter = new JsonExporter();
      await exporter.export(report, save.filePath);
    } else {
      await fs.writeFile(save.filePath, JSON.stringify(report, null, 2), "utf8");
    }

    return { ok: true, filePath: save.filePath };
  });
}

module.exports = { registerReportIpc };
