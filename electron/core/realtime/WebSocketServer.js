import { WebSocket, WebSocketServer as WsServer } from 'ws'
import http from 'http'

class WebSocketServer {
  constructor(port = 9000) {
    this.port = port
    this.server = null
    this.wss = null
    this.clients = new Set()
  }

  async start() {
    if (this.server) {
      return
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer()
      this.wss = new WsServer({ server: this.server })

      this.wss.on('connection', (ws) => {
        console.log('[WebSocketServer] Client connected')
        this.clients.add(ws)

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(String(data))
            this.handleMessage(ws, message)
          } catch (e) {
            console.error('[WebSocketServer] Error parsing message:', e.message)
          }
        })

        ws.on('close', () => {
          console.log('[WebSocketServer] Client disconnected')
          this.clients.delete(ws)
        })

        ws.on('error', (error) => {
          console.error('[WebSocketServer] WebSocket error:', error.message)
        })
      })

      this.wss.on('error', (error) => {
        console.error('[WebSocketServer] Server error:', error.message)
      })

      this.server.listen(this.port, () => {
        console.log(`[WebSocketServer] Listening on port ${this.port}`)
        resolve()
      })

      this.server.on('error', (error) => {
        reject(error)
      })
    })
  }

  async stop() {
    if (!this.server) {
      return
    }

    return new Promise((resolve) => {
      this.clients.forEach(ws => ws.close())
      this.wss?.close(() => {
        this.server?.close(() => {
          this.clients.clear()
          this.wss = null
          this.server = null
          resolve()
        })
      })
    })
  }

  broadcast(message) {
    const data = JSON.stringify(message)
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })
  }

  emit(type, data) {
    this.broadcast({
      type,
      timestamp: Date.now(),
      data
    })
  }

  emitLog(message, level = 'info') {
    this.emit('log', { message, level })
  }

  emitFinding(finding) {
    this.emit('finding', finding)
  }

  emitScanProgress(phase, progress, total) {
    this.emit('scan_progress', {
      phase,
      percent: Math.round((progress / total) * 100),
      phaseName: phase
    })
  }

  emitContainerStatus(container, status) {
    this.emit('container', { name: container, status })
  }

  emitRequest(request) {
    this.emit('request', request)
  }

  handleMessage(ws, message) {
    console.log('[WebSocketServer] Message received:', message.type)
    const type = String(message?.type || '').trim()
    if (!type) {
      return
    }

    const relayTypes = new Set(['gitgate:start', 'gitgate:log', 'gitgate:result'])
    if (!relayTypes.has(type)) {
      return
    }

    const payload = message?.data && typeof message.data === 'object'
      ? message.data
      : {}

    this.broadcast({
      type,
      timestamp: Number(message?.timestamp || Date.now()),
      data: {
        ...payload,
        source: String(message?.source || payload?.source || 'ws-client'),
      }
    })
  }
}

export default WebSocketServer
