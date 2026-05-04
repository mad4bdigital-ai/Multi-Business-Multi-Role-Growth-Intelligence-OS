import mysql from "mysql2/promise";

let pool = null;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      timezone: "Z",
    });
  }
  return pool;
}

export async function testConnection() {
  const conn = await getPool().getConnection();
  await conn.ping();
  conn.release();
}
