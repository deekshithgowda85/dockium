class PayloadLibrary {
  constructor() {
    this.map = {
      text: ["<script>alert(1)</script>", "' OR 1=1--"],
      search: ["%27%20OR%201%3D1--", "../../etc/passwd"],
      email: ["test@example.com'--", '"@test.local'],
      id: ['-1', '0', '2147483647', "1 OR 1=1"],
      price: ['-1', '0', '9999999999'],
      file: ['../../../etc/passwd', '..\\..\\windows\\win.ini'],
      date: ['1900-01-01', '9999-12-31', "' OR 1=1--"],
      textarea: ["<img src=x onerror=alert(1)>"]
    }
  }

  getPayloads(fieldType) {
    return this.map[fieldType] || this.map.text
  }
}

export default PayloadLibrary
