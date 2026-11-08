import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// Keep DATE columns as YYYY-MM-DD text. Turned into a JavaScript Date they become local midnight,
// and in Nairobi (UTC+3) that prints as the previous day.
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value) => value);

export function connect(url = process.env.DATABASE_URL): pg.Pool {
  if (!url) throw new Error("Set DATABASE_URL to a PostgreSQL connection string");
  return new pg.Pool({ connectionString: url, max: 2 });
}

/** Apply each migration once, in name order, each in its own transaction. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const name of (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(path.join(MIGRATIONS, name), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      applied.push(name);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return applied;
}
