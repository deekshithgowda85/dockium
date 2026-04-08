class FieldAnalyzer {
  async analyze(page) {
    return await page.$$eval('input,textarea,select', (nodes) => nodes.map((node) => {
      const type = (node.getAttribute('type') || node.tagName || 'text').toLowerCase()
      const name = node.getAttribute('name') || node.getAttribute('id') || ''
      const placeholder = node.getAttribute('placeholder') || ''
      let fieldType = 'text'

      if (type.includes('email')) fieldType = 'email'
      else if (type.includes('password')) fieldType = 'password'
      else if (name.includes('search')) fieldType = 'search'
      else if (name.includes('id')) fieldType = 'id'
      else if (name.includes('price') || type.includes('number')) fieldType = 'price'
      else if (type.includes('date')) fieldType = 'date'
      else if (type.includes('file')) fieldType = 'file'
      else if (node.tagName.toLowerCase() === 'textarea') fieldType = 'textarea'

      return { selector: name ? `[name="${name}"]` : '', type: fieldType, name, placeholder }
    }))
  }
}

export default FieldAnalyzer
