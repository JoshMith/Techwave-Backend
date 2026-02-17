import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  // For local development, comment out the ssl option
  // check if environment variable is set to production, if so, use ssl, otherwise do not use ssl
  ssl:
    process.env.ENVIRONMENT === "production"
      ? {
          rejectUnauthorized: false, // Required for Render
        }
      : false,
});
pool.query("SELECT NOW()", (err, result) => {
  if (err) {
    console.error("Error connecting to database:", err);
  } else {
    console.log("Database connected:", result.rows);
  }
});

export default pool;
