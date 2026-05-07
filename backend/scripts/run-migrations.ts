// Tiny migration runner: applies any *.sql file in backend/migrations/ in
// alphabetical order, recording each in schema_migrations. Idempotent.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { exec, pool, query, type RowDataPacket } from "../src/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migDir = path.resolve(here, "../migrations");

// Naive splitter: assumes no semicolons inside string literals (true for our DDL).
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*[\r\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
}

async function main() {
  // bootstrap migrations table
  await exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB`);

  const files = (await readdir(migDir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (await query<RowDataPacket & { name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name)
  );

  for (const f of files) {
    if (applied.has(f)) { console.log(`= ${f} (skip)`); continue; }
    const sql = await readFile(path.join(migDir, f), "utf8");
    const stmts = splitStatements(sql);
    console.log(`> ${f} (${stmts.length} statements)`);
    for (const s of stmts) await exec(s);
    await exec("INSERT INTO schema_migrations (name) VALUES (?)", [f]);
    console.log(`✓ ${f}`);
  }

  await pool().end();
}

main().catch((e) => { console.error(e); process.exit(1); });
