require("dotenv").config();

const pool = require("./config/database");

async function testDatabase() {
  try {
    const result = await pool.query("SELECT NOW()");
    console.log("Neon connected successfully:", result.rows[0]);
  } catch (error) {
    console.error("Database connection failed:", error.message);
  } finally {
    await pool.end();
  }
}

testDatabase();