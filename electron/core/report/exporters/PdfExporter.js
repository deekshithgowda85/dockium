import fs from 'fs'
import PDFDocument from 'pdfkit'

function ensureSpace(doc, minHeight = 44) {
  const bottom = doc.page.height - doc.page.margins.bottom
  if (doc.y + minHeight > bottom) {
    doc.addPage()
  }
}

function heading(doc, text) {
  ensureSpace(doc, 32)
  doc.moveDown(0.5)
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111').text(String(text || 'Section'))
  doc.moveDown(0.2)
}

function line(doc, label, value) {
  ensureSpace(doc, 20)
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111').text(`${label}: `, { continued: true })
  doc.font('Helvetica').fontSize(10).fillColor('#111111').text(String(value || 'n/a'))
}

function paragraph(doc, label, value) {
  ensureSpace(doc, 60)
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111').text(`${label}:`)
  doc.font('Helvetica').fontSize(10).fillColor('#111111').text(String(value || 'n/a'), {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
  })
}

class PdfExporter {
  async export(reportObject, outputPath) {
    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const stream = fs.createWriteStream(outputPath)
      doc.pipe(stream)

      doc.font('Helvetica-Bold').fontSize(18).fillColor('#111111').text('DOCKIUM Security Report')
      doc.moveDown(0.2)
      line(doc, 'Project', reportObject?.meta?.projectName)
      line(doc, 'Framework', reportObject?.meta?.framework)
      line(doc, 'Generated', reportObject?.meta?.timestamp)
      line(doc, 'Duration (ms)', reportObject?.meta?.duration)
      line(doc, 'Mode', reportObject?.meta?.scanMode)

      heading(doc, 'Executive Summary')
      line(doc, 'Total Findings', reportObject?.summary?.total || 0)
      line(doc, 'Weighted Risk', reportObject?.summary?.weightedRisk || 0)
      line(doc, 'Average Risk', reportObject?.summary?.avgRisk || 0)

      const bySeverity = reportObject?.summary?.bySeverity || {}
      for (const [severity, count] of Object.entries(bySeverity)) {
        line(doc, `Severity ${String(severity || '').toUpperCase()}`, count)
      }

      const byEngine = reportObject?.summary?.byEngine || {}
      if (Object.keys(byEngine).length > 0) {
        heading(doc, 'Engine Distribution')
        for (const [engine, count] of Object.entries(byEngine)) {
          line(doc, String(engine || 'core'), count)
        }
      }

      const operations = reportObject?.operations || {}
      if (Object.keys(operations).length > 0) {
        heading(doc, 'Operations Snapshot')
        paragraph(doc, 'Artemis', JSON.stringify(operations.artemis || {}, null, 2))
        paragraph(doc, 'Browser Use', JSON.stringify(operations.browserUse || {}, null, 2))
        paragraph(doc, 'Proxy', JSON.stringify(operations.proxy || {}, null, 2))
      }

      const proxyEvidence = Array.isArray(reportObject?.evidence?.proxyRecentRequests)
        ? reportObject.evidence.proxyRecentRequests
        : Array.isArray(reportObject?.operations?.proxy?.recentRequests)
          ? reportObject.operations.proxy.recentRequests
          : []

      if (proxyEvidence.length > 0) {
        heading(doc, 'Proxy Request/Response Evidence')
        proxyEvidence.slice(0, 20).forEach((entry, index) => {
          ensureSpace(doc, 140)
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111')
            .text(`${index + 1}. ${String(entry?.method || 'GET').toUpperCase()} ${entry?.path || '/'} (${entry?.status || 0})`)
          line(doc, 'Host', entry?.host || 'n/a')
          line(doc, 'Flag', entry?.flag || 'normal')
          line(doc, 'Formats', `${entry?.requestFormat || 'unknown'} -> ${entry?.responseFormat || 'unknown'}`)
          line(doc, 'Bytes', `${Number(entry?.requestBytes || 0)} / ${Number(entry?.responseBytes || 0)}`)
          line(doc, 'Duration (ms)', Number(entry?.durationMs || 0))
          paragraph(doc, 'Request', entry?.requestRaw || 'n/a')
          paragraph(doc, 'Response', entry?.responseRaw || 'n/a')
          doc.moveDown(0.3)
        })
      }

      if (Array.isArray(reportObject?.owaspChecklist) && reportObject.owaspChecklist.length > 0) {
        heading(doc, 'OWASP Top 10 Checklist')
        for (const item of reportObject.owaspChecklist) {
          line(doc, `${item.id || '--'} ${item.label || 'Rule'}`, `${item.status || 'UNKNOWN'} (${item.detail || 'n/a'})`)
        }
      }

      if (Array.isArray(reportObject?.findings) && reportObject.findings.length > 0) {
        heading(doc, 'Findings')
        reportObject.findings.forEach((finding, index) => {
          ensureSpace(doc, 120)
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111')
            .text(`${index + 1}. [${String(finding?.severity || 'info').toUpperCase()}] ${finding?.title || 'Untitled finding'}`)
          line(doc, 'Endpoint', finding?.endpoint || 'n/a')
          paragraph(doc, 'Description', finding?.description || 'n/a')
          paragraph(doc, 'Fix', finding?.fix || 'n/a')
          if (finding?.proof) {
            paragraph(doc, 'Proof', finding.proof)
          }
          doc.moveDown(0.4)
        })
      } else {
        heading(doc, 'Findings')
        doc.font('Helvetica').fontSize(10).fillColor('#111111').text('No findings were captured in the current report.')
      }

      if (Array.isArray(reportObject?.remediationChecklist) && reportObject.remediationChecklist.length > 0) {
        heading(doc, 'Remediation Checklist')
        reportObject.remediationChecklist.forEach((item, index) => {
          line(doc, `${index + 1}`, `${item.done ? '[x]' : '[ ]'} ${item.text || 'Action item'}`)
        })
      }

      doc.end()
      stream.on('finish', resolve)
      stream.on('error', reject)
    })

    return outputPath
  }
}

export default PdfExporter
