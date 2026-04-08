# DOCKIUM - Technical Architecture Deep Dive

## System Design Overview

```
┌─────────────────────────────────────────────────────────────┐
│              DESKTOP APPLICATION (Electron)                 │
│                                                              │
│  ┌──────────────────┐          ┌──────────────────────┐    │
│  │   React UI       │          │  Main Process (IPC)  │    │
│  │                  │  IPC      │                      │    │
│  │ • Dashboard      │◄────────► │ • Container Mgr      │    │
│  │ • App Map        │   Bridge  │ • Scan Orchestrator  │    │
│  │ • Scanner        │           │ • Proxy Engine       │    │
│  │ • Reports        │           │ • Report Generator   │    │
│  │ • Proxy Views    │           │ • Git Integration    │    │
│  └──────────────────┘           └──────────────────────┘    │
│                                          │                  │
│                                   WebSocket (Live Events)   │
│                                          │                  │
└──────────────────────────────────────────┼──────────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
              ▼                            ▼                            ▼
    ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
    │   Docker API     │      │  File System     │      │   Git API        │
    │  (dockerode)     │      │  (Glob, FS)      │      │  (simple-git)    │
    └────────┬─────────┘      └────────┬─────────┘      └────────┬─────────┘
             │                         │                         │
             └─────────────────────────┼─────────────────────────┘
                                       │
             ┌─────────────────────────┴─────────────────────────┐
             │        Container Runtime (Docker Desktop)        │
             └─────────────────────────┬─────────────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
        ▼                              ▼                              ▼
    ┌─────────────┐            ┌────────────────┐            ┌──────────────┐
    │ dockium-app │            │ dockium-scanner│            │ nuclei-task  │
    │             │            │                │            │              │
    │ Your App    │            │ Node.js        │            │ Nuclei       │
    │ (imported   │            │ + Playwright   │            │ Active Scan  │
    │  or built)  │            │ + Discovery    │            │ (ephemeral)  │
    └─────────────┘            │ Engine         │            │              │
                               └────────────────┘            └──────────────┘
```

## Core Modules (Electron Main Process)

### 1. Container Orchestrator (`ContainerManager.js`)

**Responsibility**: Manage Docker container lifecycle

**Key Methods**:

```javascript
async startAll(config)              // Boot all containers in order
async startApp(config)              // Build/run target application
async startScanner(config)          // Start discovery + scanning engine
async runNucleiScan(config)         // Run Dockerized Nuclei active scan
async startProxy(config)            // Start HTTP intercept proxy
async removeIfExists(name)          // Safe container cleanup (retry logic)
async waitForPort(port, name)       // Health check for container readiness
```

**Network Setup**:

- Creates isolated Docker network: `dockium-net`
- All containers connect to this network
- App accessible inside network as `http://dockium-app:3000`
- External access via `localhost:3000`

**Health Monitoring**:

- Polls container ports after startup
- Timeouts: App (30sec), Scanner (immediate)
- Nuclei runs as an ephemeral task container per active scan request
- Retries with exponential backoff

---

### 2. Project Analysis (`detector/`, `mapper/`)

#### `FrameworkDetector.js`

Analyzes source code to identify framework:

```javascript
async detectFramework(projectPath) {
  // Reads package.json / requirements.txt / Gemfile / composer.json
  // Returns: { framework, language, version, entryPoint }
  // Supports: Express, Next.js, Django, FastAPI, Rails, Laravel
}
```

#### `FolderTreeBuilder.js`

Maps file structure with security annotations:

```
src/
├── routes/
│   ├── auth.js         [🔴 CRITICAL: Hardcoded JWT secret]
│   ├── users.js        [🟡 MEDIUM: SQL injection risk]
│   └── admin.js        [🟠 HIGH: Missing auth guard]
├── models/
│   └── User.js         [✅ No issues]
```

#### `RouteExtractor.js`

Discovers all HTTP endpoints:

```
GET    /api/users              [No Auth]
GET    /api/users/:id          [SQL Injection Risk]
POST   /api/users              [Missing CSRF]
PATCH  /api/users/:id          [Auth Required]
DELETE /api/users/:id          [Admin Only]
```

#### `ApiGraphBuilder.js`

Builds visual dependency graph:

```
POST /users → Model.User.create()
           → Email Service
           → Webhook → /api/log
```

---

### 3. Discovery & Scanning Engine (`scanner/`)

#### `DiscoveryEngine.js`

Uses Playwright browser automation to crawl application:

```javascript
async discover(targetUrl, options) {
  // 1. Launch headless browser
  // 2. Navigate to app
  // 3. Click all links, fill forms
  // 4. Track HTTP requests
  // Returns: { routes, endpoints, cookies, auth_required }
}
```

**Browser Fleet**: Parallel headless browsers (by default 4 instances)

- Distributes crawling across browsers
- Throttles requests to avoid overwhelming target
- Captures headers, cookies, response bodies

#### Modular Scanners

Each scanner is independent and can run in parallel:

**`ApiScanner.js`** - Endpoint vulnerability detection

```
Checks:
- Missing authentication on endpoints
- Missing HTTP security headers
- Weak CORS policies
- Exposed API endpoints
Output: List of unprotected routes + remediation hints
```

**`AuthScanner.js`** - Authentication/Authorization flaws

```
Checks:
- JWT validation
- Session management
- Token refresh mechanisms
- Authorization boundaries
- Role-based access control
Output: Auth flow diagrams + bypass techniques
```

**`DependencyScanner.js`** - CVE vulnerability detection

```
Reads: package.json, requirements.txt, Gemfile, pom.xml, etc.
Queries: NPM/PyPI security advisories + GitHub CVE database
Returns: {
  package: "lodash",
  version: "4.15.0",
  vulnerability: "Prototype Pollution",
  cve: "CVE-2018-16487",
  severity: "HIGH",
  fix: "Update to 4.17.11+"
}
```

**`SecretsScanner.js`** - Exposed credentials detection

```
Patterns searched:
- AWS_SECRET_KEY=
- PRIVATE_KEY=-----BEGIN
- mongodb+srv://user:pass@
- Database URLs with credentials
- API keys in .env files
Output: File paths + line numbers of exposed secrets
```

**`InfraScanner.js`** - Infrastructure misconfiguration

```
Checks:
- Dockerfile exposed secrets
- Docker Compose credentials
- Environment variable exposure
- Network configuration risks
- Container privilege escalation
```

---

### 4. Proxy Engine (`proxy/`)

#### `ProxyServer.js`

MITM (Man-in-the-Middle) HTTP proxy:

```javascript
// Intercepts all HTTP/HTTPS traffic from browser
// Logs request/response pairs
// Can modify headers, body, timing
// Feeds suspicious requests into active scan workflows
```

**Flow**:

```
Browser Request → ProxyServer
                    ↓
                [Log & Inspect]
                    ↓
                [Apply Rules]
                    ↓
                [Forward to active scan workflow if suspicious]
                    ↓
              Original Server
```

#### `RequestCapture.js`

Captures all HTTP traffic details:

```javascript
{
  method: "GET",
  url: "/api/users/1",
  headers: { Authorization: "Bearer abc123" },
  body: "",
  response: {
    status: 200,
    body: "[{id:1,name:John}]",
    headers: { "Content-Type": "application/json" }
  },
  timestamp: "2025-04-08T10:30:00Z"
}
```

#### `NucleiScanner.js`

Integrates Dockerized Nuclei active scanning:

```javascript
async scan(targetUrl) {
  // Candidate URLs:
  // 1. http://host.docker.internal:3000
  // 2. http://dockium-app:3000 (Docker network)
  // 3. original target URL

  // Runs nuclei with critical/high severity filters
  // Returns findings: { severity, title, endpoint, description, proof, fix }
}
```

---

### 5. Scan Orchestrator (`scanner/ScanOrchestrator.js`)

Coordinates all scanning modules:

```javascript
async runFullScan(config) {
  // 1. Ensure all containers are running
  await this.ensureContainers(config)

  // 2. Run discovery in parallel with API scanner
  const [discovery, apiVulns] = await Promise.all([
    discoveryEngine.discover(targetUrl),
    apiScanner.scan(targetUrl)
  ])

  // 3. Run specialized scanners
  const [authVulns, secretVulns, depVulns, infraVulns] =
    await Promise.all([
      authScanner.scan(projectPath, discovery),
      secretsScanner.scan(projectPath),
      dependencyScanner.scan(projectPath),
      infraScanner.scan(projectPath)
    ])

  // 4. Run active Nuclei scan
  const nucleiFindings = await nucleiScanner.scan(targetUrl)

  // 5. Aggregate results
  return mergeResults({
    discovery,
    apiVulns,
    authVulns,
    secretVulns,
    depVulns,
    infraVulns,
    nucleiFindings
  })
}
```

**Parallelization**:

- Discovery + API Scanner: Parallel (share browser)
- Auth/Secrets/Infra: Parallel (static analysis)
- Dependencies: Parallel (package analysis)
- Nuclei: Active scan task per run

**Result Structure**:

```javascript
{
  timestamp: "2025-04-08T10:30:00Z",
  duration: 187000, // milliseconds
  status: "completed",
  vulnerabilities: [
    {
      severity: "CRITICAL",
      type: "APIVulnerability",
      endpoint: "/api/users/:id",
      message: "SQL Injection in user_id parameter",
      sourcePath: "routes/users.js:45",
      evidence: "?user_id=1 OR 1=1",
      remediation: "Use parameterized queries"
    },
    // ... more findings
  ]
}
```

---

### 6. Report Generator (`report/`)

#### `ReportBuilder.js`

Structures findings into exportable format:

```javascript
class ReportBuilder {
  build(scanResult) {
    return {
      title: `Security Report: ${projectName}`,
      executiveSummary: {...},
      scorecard: {
        critical: 1,
        high: 3,
        medium: 5,
        low: 12,
        overallScore: 32  // 0-100
      },
      findings: [
        {
          severity: "CRITICAL",
          type: "SQLInjection",
          endpoint: "/api/users/:id",
          source_file: "routes/users.js",
          source_line: 45,
          attack_vector: "...payload...",
          impact: "Database compromise",
          remediation: "Use parameterized queries or ORM"
        }
      ],
      remediationPriority: [
        // Sorted by impact * exploitability
      ]
    }
  }
}
```

#### Export Formats

**PDF Export** (using pdfkit):

- Professional layout with logos
- Color-coded severity levels
- Charts and statistics
- Printable format

**Markdown Export**:

```markdown
# Security Report: MyApp

## Executive Summary

Found 9 vulnerabilities during security assessment.

### Critical Issues (1)

- **SQL Injection** in `/api/users/:id`
  - **File**: routes/users.js:45
  - **Evidence**: `?user_id=1 OR 1=1`
  - **Fix**: Use parameterized queries
```

**JSON Export**:

- Machine-readable format
- Integrates with issue trackers
- Custom dashboarding

---

### 7. Git Integration (`git/`)

#### `GitGate.js` - Pre-Push Hook

```javascript
async enforcePrePushGate() {
  // 1. Get list of files being pushed
  const diff = await git.getDiff()

  // 2. Run quick security scan on changed files
  const issues = await quickScan(diff.files)

  // 3. Block push if critical issue found
  if (issues.critical.length > 0) {
    throw new Error(`
      ❌ SECURITY GATE BLOCKED PUSH
      ${issues.critical.length} critical vulnerabilities found:
      ${issues.critical.map(i => \`- \${i.message}\`).join('\n')}

      Fix these issues before pushing.
    `)
  }

  // 4. Allow push
  console.log("✅ Security checks passed. Push allowed.")
}
```

#### `GitHookInstaller.js`

```bash
# .git/hooks/pre-push (auto-installed by Dockium)
#!/bin/bash
node -e "
  const gate = require('./GitGate.js');
  gate.enforcePrePushGate().catch(e => {
    console.error(e.message);
    process.exit(1);
  });
"
```

---

## IPC Bridge Architecture

Electron IPC enables React UI ↔ Main Process communication.

### Handler Pattern

```javascript
// Main Process
ipcMain.handle("docker:startAll", async (event, config) => {
  return await containerManager.startAll(config);
});

// React Component
const result = await ipcRenderer.invoke("docker:startAll", config);
```

### WebSocket for Live Events

For long-running operations (scanning, container startup):

```javascript
// Main Process emits events
wss.emit("scan_progress", {
  scanId: "abc123",
  percent: 45,
  currentModule: "ApiScanner",
});

// React Component listens
useEffect(() => {
  const unsubscribe = wsStore.subscribe((msg) => {
    if (msg.type === "scan_progress") {
      setProgress(msg.percent);
    }
  });
  return unsubscribe;
}, []);
```

---

## Data Flow: End-to-End Scan

```
User clicks "Start Scan"
        ↓
React invokes IPC "scan:start"
        ↓
Main Process: ScanOrchestrator.runFullScan()
        ↓
    ┌─────────────────────────────────────────┐
    │ Parallel Phase 1: Discovery             │
    ├─────────────────────────────────────────┤
    │ • DiscoveryEngine uses Playwright       │
    │   to crawl app, extract routes          │
    │ • ProxyServer captures HTTP traffic     │
    │ • Build route/API graph                 │
    └─────────────────────────────────────────┘
        ↓
    Emit WebSocket: "discovery_complete"
        ↓
    ┌─────────────────────────────────────────┐
    │ Parallel Phase 2: Module Scans          │
    ├─────────────────────────────────────────┤
    │ • ApiScanner: Check endpoints           │
    │ • AuthScanner: Verify auth flows        │
    │ • SecretsScanner: Find exposed keys     │
    │ • DependencyScanner: Query CVEs         │
    │ • InfraScanner: Config issues           │
    └─────────────────────────────────────────┘
        ↓
    Emit WebSocket: "module_complete" (per module)
        ↓
    ┌─────────────────────────────────────────┐
    │ Active Scan Phase: Nuclei Task          │
    ├─────────────────────────────────────────┤
    │ • NucleiScanner runs in Docker          │
    │ • Critical/high templates execute       │
    │ • Findings normalized into scan result  │
    └─────────────────────────────────────────┘
        ↓
    Emit WebSocket: "nuclei_progress"
        ↓
    Scan completes (user clicks "Stop" or 100%)
        ↓
    Aggregate all findings → ScanResult
        ↓
    ReportBuilder.build(result)
        ↓
    User can: View in UI, Export, Review, Fix code
```

---

## Performance Optimizations

1. **Parallel Scanning**: Modules run concurrently, not sequentially
2. **Lazy Container Creation**: Containers only created on-demand
3. **Connection Pooling**: Reuse DB/API connections
4. **Caching**: Framework detection cached per project
5. **Incremental Scanning**: Option to rescan only changed files
6. **Browser Viewport Throttling**: Limits concurrent requests

**Typical Scan Times**:

- Small project (< 100 routes): 2-3 minutes
- Medium project (100-500 routes): 5-10 minutes
- Large project (500+ routes): 15-30 minutes

---

## Security Considerations

### Isolation

- Each scan runs in isolated Docker containers
- No container can access host file system without explicit mount
- Network isolation via Docker network

### Data Privacy

- **No Cloud Upload**: All scan data stays local
- **No Telemetry**: Dockium doesn't phone home
- **No Account Required**: Works offline
- **Open Source**: Code auditable by security community

### Secrets Handling

- Found secrets are stored only in local SQLite DB
- Encrypted at rest
- Never persisted to logs
- User can delete findings anytime

---

## Extensibility

### Plugin Architecture

Users can add custom scanners:

```javascript
// Custom Scanner Plugin
export class CustomScanner {
  async scan(projectPath, config) {
    return [
      {
        severity: "HIGH",
        type: "CustomIssue",
        message: "...",
        sourcePath: "...",
        remediation: "...",
      },
    ];
  }
}

// Register in config
dockium.register("customScanner", CustomScanner);
```

---

## Roadmap

- [ ] Batch project scanning
- [ ] Org-wide dashboard
- [ ] GitHub Actions integration
- [ ] Custom rule engine
- [ ] Machine learning for false positive reduction
- [ ] API marketplace for plugins
- [ ] Multi-user collaboration (team scans)
- [ ] Mobile app scanning support
