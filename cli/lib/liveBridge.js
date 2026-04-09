import WebSocket from 'ws'

const DEFAULT_WS_URL = 'ws://127.0.0.1:4242'

class LiveBridge {
  constructor(url = DEFAULT_WS_URL, timeoutMs = 400) {
    this.url = url
    this.timeoutMs = timeoutMs
    this.socket = null
  }

  async connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return true
    }

    return await new Promise((resolve) => {
      let settled = false
      let timer = null
      const ws = new WebSocket(this.url)

      const finalize = (ok) => {
        if (settled) {
          return
        }
        settled = true
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        if (!ok) {
          try {
            ws.close()
          } catch {}
        }
        this.socket = ok ? ws : null
        resolve(ok)
      }

      timer = setTimeout(() => finalize(false), this.timeoutMs)
      ws.on('open', () => finalize(true))
      ws.on('error', () => finalize(false))
      ws.on('close', () => {
        if (!settled) {
          finalize(false)
        }
      })
    })
  }

  emit(type, data = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }

    try {
      this.socket.send(JSON.stringify({
        type,
        timestamp: Date.now(),
        source: 'dockium-cli',
        data,
      }))
    } catch {}
  }

  close() {
    if (!this.socket) {
      return
    }

    try {
      this.socket.close()
    } catch {}
    this.socket = null
  }
}

export default LiveBridge
