import FrameworkDetector from '../detector/FrameworkDetector.js'
import EnvDetector from '../detector/EnvDetector.js'
import { generateDockerfile } from '../docker/generator.js'
import SchemaCloner from '../db/SchemaCloner.js'
import DataSeeder from '../db/DataSeeder.js'
import DiscoveryEngine from '../scanner/DiscoveryEngine.js'

class Ingestion {
  constructor(containerManager, wss = null) {
    this.containerManager = containerManager
    this.wss = wss
  }

  async ingest(repoPath, config) {
    const detector = new FrameworkDetector()
    const envDetector = new EnvDetector()
    const schemaCloner = new SchemaCloner()
    const seeder = new DataSeeder()

    const frameworkInfo = await detector.detect(repoPath)
    this.wss?.emitLog(`Detected: ${frameworkInfo.framework} ${frameworkInfo.version}`)

    const envString = await envDetector.generateEnv(repoPath, frameworkInfo)
    this.wss?.emitLog('Generated .env with runtime defaults')

    await generateDockerfile(repoPath, { ...frameworkInfo, appPort: config.project.appPort })
    this.wss?.emitLog(`Generated Dockerfile for ${frameworkInfo.framework}`)

    const schemaInfo = await schemaCloner.clone(repoPath, frameworkInfo)
    this.wss?.emitLog(`Cloned schema: ${schemaInfo.tables.length} tables detected`)

    const containerStatus = await this.containerManager.startAll({ ...config, wss: this.wss })
    const seed = await seeder.seed(schemaInfo.tables, { dbType: config.project.dbType })
    this.wss?.emitLog(`Seeded ${seed.recordsInserted} records across ${seed.tablesCovered} tables`)

    const discovery = new DiscoveryEngine(config, repoPath)
    const appMap = await discovery.scanAppMap({
      targetUrl: config?.project?.targetUrl,
    })

    return {
      success: true,
      frameworkInfo,
      containerStatus,
      routeCount: appMap.routeTree.length,
      tableCount: schemaInfo.tables.length,
      appMap,
      envString
    }
  }
}

export default Ingestion
