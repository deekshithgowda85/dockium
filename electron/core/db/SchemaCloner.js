import fs from 'fs'
import path from 'path'

function parsePrismaModels(schema) {
  const models = []
  const blocks = schema.match(/model\s+\w+\s+\{[\s\S]*?\}/g) || []
  for (const block of blocks) {
    const [header, ...rows] = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const name = header.split(/\s+/)[1]
    const columns = rows
      .filter((row) => !row.startsWith('@@') && row !== '}')
      .map((row) => {
        const [col, type] = row.split(/\s+/)
        const sqlType = /int/i.test(type) ? 'INTEGER' : /date|time/i.test(type) ? 'TIMESTAMP' : 'TEXT'
        return { name: col, type: sqlType, nullable: !type.includes('?') }
      })
    models.push({ name, columns })
  }
  return models
}

class SchemaCloner {
  async clone(repoPath, frameworkInfo) {
    const prisma = path.join(repoPath, 'prisma', 'schema.prisma')
    if (fs.existsSync(prisma)) {
      const content = fs.readFileSync(prisma, 'utf8')
      const tables = parsePrismaModels(content)
      return { tables, ddl: this.toDdl(tables) }
    }

    return { tables: [], ddl: '' }
  }

  toDdl(tables) {
    return tables.map((table) => {
      const cols = table.columns.map((col) => `${col.name} ${col.type}${col.nullable ? '' : ' NOT NULL'}`).join(',\n  ')
      return `CREATE TABLE IF NOT EXISTS ${table.name} (\n  ${cols}\n);`
    }).join('\n\n')
  }
}

export default SchemaCloner
