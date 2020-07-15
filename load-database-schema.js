const { promises: fsp } = require("fs");
const pg = require("pg");

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const sql = await fsp.readFile("./my_database_schema.sql", "utf8");
    await pool.query(sql);
    console.log("Database initialised");
  } finally {
    pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
