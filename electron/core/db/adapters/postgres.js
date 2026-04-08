import pg from 'pg'

export async function connect(dbConfig) {
  const client = new pg.Client({ connectionString: dbConfig.url })
  await client.connect()
  return client
}

export async function exec(client, sql, params = []) {
  const result = await client.query(sql, params)
  return result.rows
}

export async function disconnect(client) {
  await client.end()
}
