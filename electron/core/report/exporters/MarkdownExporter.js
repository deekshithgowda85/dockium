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

    lines.push('', '## Operations')
    lines.push('### Artemis')
    lines.push('```json')
    lines.push(JSON.stringify(reportObject?.operations?.artemis || {}, null, 2))
    lines.push('```')
    lines.push('')
    lines.push('### Browser Use')
    lines.push('```json')
    lines.push(JSON.stringify(reportObject?.operations?.browserUse || {}, null, 2))
    lines.push('```')
    lines.push('')
    lines.push('### Proxy')
    lines.push('```json')
    lines.push(JSON.stringify(reportObject?.operations?.proxy || {}, null, 2))
    lines.push('```')

    lines.push('', '## Findings')
    for (const finding of reportObject.findings || []) {
      lines.push(`### [${finding.severity.toUpperCase()}] ${finding.title}`)
      lines.push(`- Endpoint: ${finding.endpoint || 'n/a'}`)
      lines.push(`- Description: ${finding.description || 'n/a'}`)
      lines.push(`- Fix: ${finding.fix || 'n/a'}`)
      lines.push('')
    }

    const proxyEvidence = Array.isArray(reportObject?.evidence?.proxyRecentRequests)
      ? reportObject.evidence.proxyRecentRequests
      : Array.isArray(reportObject?.operations?.proxy?.recentRequests)
        ? reportObject.operations.proxy.recentRequests
        : []

    lines.push('## Proxy Request/Response Evidence')
    if (proxyEvidence.length === 0) {
      lines.push('- No proxy evidence captured')
    } else {
      for (const entry of proxyEvidence.slice(0, 30)) {
        lines.push(`### ${String(entry?.method || 'GET').toUpperCase()} ${entry?.path || '/'} [${entry?.status || 0}]`)
        lines.push(`- Host: ${entry?.host || 'n/a'}`)
        lines.push(`- Flag: ${entry?.flag || 'normal'}`)
        lines.push(`- Formats: ${entry?.requestFormat || 'unknown'} -> ${entry?.responseFormat || 'unknown'}`)
        lines.push(`- Bytes: ${Number(entry?.requestBytes || 0)} / ${Number(entry?.responseBytes || 0)}`)
        lines.push(`- Duration: ${Number(entry?.durationMs || 0)}ms`)
        lines.push('```http')
        lines.push(String(entry?.requestRaw || ''))
        lines.push('```')
        lines.push('```http')
        lines.push(String(entry?.responseRaw || ''))
        lines.push('```')
        lines.push('')
      }
    }

    await fs.writeFile(outputPath, lines.join('\n'), 'utf8')
    return outputPath
  }
}

export default MarkdownExporter
