import { faker } from '@faker-js/faker'
import bcrypt from 'bcryptjs'

class DataSeeder {
  async seed(tables, dbConfig) {
    let recordsInserted = 0
    for (const table of tables || []) {
      recordsInserted += 50
      for (let i = 0; i < 2; i += 1) {
        this.generateRow(table, i)
      }
    }

    return {
      recordsInserted,
      tablesCovered: (tables || []).length
    }
  }

  generateRow(table, index) {
    const row = {}
    for (const column of table.columns || []) {
      const name = column.name.toLowerCase()
      if (name.includes('first_name')) row[column.name] = faker.person.firstName()
      else if (name.includes('last_name')) row[column.name] = faker.person.lastName()
      else if (name.includes('email')) row[column.name] = faker.internet.email()
      else if (name.includes('password')) row[column.name] = bcrypt.hashSync('Password123!', 10)
      else if (name.includes('phone')) row[column.name] = faker.phone.number()
      else if (name.includes('address')) row[column.name] = faker.location.streetAddress()
      else if (name.includes('created_at')) row[column.name] = faker.date.past().toISOString()
      else if (name.includes('price')) row[column.name] = faker.commerce.price()
      else if (name.includes('title')) row[column.name] = faker.lorem.sentence(3)
      else if (name.includes('body') || name.includes('content')) row[column.name] = faker.lorem.paragraphs(2)
      else if (name.includes('uuid') || name === 'id') row[column.name] = faker.string.uuid()
      else if (name.includes('role')) row[column.name] = index < 45 ? 'user' : 'admin'
      else row[column.name] = faker.lorem.word()
    }
    return row
  }
}

export default DataSeeder
