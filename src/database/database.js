import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

export async function openDatabase(databaseConfig) {
  if (!databaseConfig || typeof databaseConfig !== 'object') {
    throw new TypeError('MySQL connection configuration is required.');
  }

  const connection = await mysql.createConnection({
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.user,
    password: databaseConfig.password,
    database: databaseConfig.name,
  });
  try {
    const schema = readFileSync(schemaPath, 'utf8');
    for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
    return connection;
  } catch (error) {
    await connection.end();
    throw error;
  }
}
