import fs from 'fs/promises'

class JsonExporter {
  async export(reportObject, outputPath) {
    await fs.writeFile(outputPath, JSON.stringify(reportObject, null, 2), 'utf8')
    return outputPath
  }
}

export default JsonExporter
