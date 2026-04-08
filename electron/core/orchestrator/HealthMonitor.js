import Docker from 'dockerode'

const docker = new Docker()

class HealthMonitor {
  constructor(wss = null) {
    this.wss = wss
    this.timer = null
    this.containers = []
  }

  start(containers) {
    this.containers = containers
    if (this.timer) return
    this.timer = setInterval(async () => {
      for (const name of this.containers) {
        try {
          const container = docker.getContainer(name)
          const inspect = await container.inspect()
          const stats = await container.stats({ stream: false })
          const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats?.cpu_usage?.total_usage || 0)
          const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats?.system_cpu_usage || 0)
          const cpu = systemDelta > 0 ? Number(((cpuDelta / systemDelta) * 100).toFixed(1)) : 0
          const mem = Math.round((stats.memory_stats.usage || 0) / 1024 / 1024)

          this.wss?.emit('container', {
            name,
            status: inspect.State.Status,
            cpu,
            mem
          })
        } catch (error) {
          this.wss?.emitLog(`Health monitor error for ${name}: ${error.message}`, 'warn')
        }
      }
    }, 5000)
  }

  stop() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }
}

export default HealthMonitor
