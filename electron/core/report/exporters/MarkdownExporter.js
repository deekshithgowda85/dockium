import fs from 'fs/promises'

class MarkdownExporter {
  async export(reportObject, outputPath) {
    const lines = [
      '# DOCKIUM Security Report',
      '',
      `Project: ${reportObject.meta.projectName}`,
      `Framework: ${reportObject.meta.framework}`,
      `Generated: ${reportObject.meta.timestamp}`,
      '',
      '## Summary',
      `Total findings: ${reportObject.summary.total}`,
      ''
    ]

    for (const [severity, count] of Object.entries(reportObject.summary.bySeverity || {})) {
      lines.push(`- ${severity}: ${count}`)
    }

    lines.push('', '## Findings')
    for (const finding of reportObject.findings || []) {
      lines.push(`### [${finding.severity.toUpperCase()}] ${finding.title}`)
      lines.push(`- Endpoint: ${finding.endpoint || 'n/a'}`)
      lines.push(`- Description: ${finding.description || 'n/a'}`)
      lines.push(`- Fix: ${finding.fix || 'n/a'}`)
      lines.push('')
    }

    await fs.writeFile(outputPath, lines.join('\n'), 'utf8')
    return outputPath
  }
}

export default MarkdownExporter
