import Docker from 'dockerode'

const docker = new Docker()

class NetworkManager {
  async createNetwork(name = `dockium-${Date.now()}`) {
    const existing = await docker.listNetworks()
    const found = existing.find((network) => network.Name === name)
    if (found) return name
    await docker.createNetwork({ Name: name, Driver: 'bridge', Internal: false })
    return name
  }

  async removeNetwork(name) {
    if (!name) return
    try {
      const network = docker.getNetwork(name)
      await network.remove()
    } catch {}
  }
}

export default NetworkManager
