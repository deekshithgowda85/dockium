import fs from 'fs'
import PDFDocument from 'pdfkit'

class PdfExporter {
  async export(reportObject, outputPath) {
    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const stream = fs.createWriteStream(outputPath)
      doc.pipe(stream)

      doc.font('Courier').fontSize(18).text('DOCKIUM Security Report')
      doc.moveDown(0.5)
      doc.fontSize(11).text(`Project: ${reportObject.meta.projectName}`)
      doc.text(`Framework: ${reportObject.meta.framework}`)
      doc.text(`Generated: ${reportObject.meta.timestamp}`)

      doc.moveDown()
      doc.fontSize(14).text('Executive Summary')
      doc.fontSize(11).text(`Total Findings: ${reportObject.summary.total}`)
      for (const [severity, count] of Object.entries(reportObject.summary.bySeverity || {})) {
        doc.text(`${severity.toUpperCase()}: ${count}`)
      }

      doc.moveDown()
      doc.fontSize(14).text('Findings')
      for (const finding of (reportObject.findings || []).slice(0, 40)) {
        doc.moveDown(0.4)
        doc.fontSize(11).fillColor('black').text(`[${finding.severity.toUpperCase()}] ${finding.title}`)
        doc.text(`Endpoint: ${finding.endpoint || 'n/a'}`)
        doc.text(`Description: ${finding.description || 'n/a'}`)
        doc.text(`Fix: ${finding.fix || 'n/a'}`)
      }

      doc.end()
      stream.on('finish', resolve)
      stream.on('error', reject)
    })

    return outputPath
  }
}

export default PdfExporter
