import FieldAnalyzer from '../FieldAnalyzer.js'
import PayloadLibrary from '../PayloadLibrary.js'

class FieldFuzzer {
  constructor(session, config) {
    this.session = session
    this.config = config
    this.analyzer = new FieldAnalyzer()
    this.payloads = new PayloadLibrary()
  }

  async run() {
    const fields = await this.analyzer.analyze(this.session.page)
    for (const field of fields.slice(0, 20)) {
      if (!field.selector) continue
      const payloadSet = this.payloads.getPayloads(field.type)
      const payload = payloadSet[0]
      try {
        await this.session.page.fill(field.selector, payload)
        this.session.recordFinding({
          severity: field.type === 'id' || field.type === 'search' ? 'high' : 'medium',
          title: `Fuzz payload submitted (${field.type})`,
          endpoint: this.session.lastUrl,
          description: `Payload executed for ${field.name || field.selector}`,
          payload
        })
      } catch {
        this.session.log(`Skipped non-editable field ${field.selector}`)
      }
    }
  }
}

export default FieldFuzzer
