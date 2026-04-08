import mysql from 'mysql2/promise'

export async function connect(dbConfig) {
  return await mysql.createConnection(dbConfig)
}

export async function exec(client, sql, params = []) {
  const [rows] = await client.execute(sql, params)
  return rows
}

export async function disconnect(client) {
  await client.end()
}
