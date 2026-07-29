import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const DB_DIR = "tests/.tmp";
const DB_URL = "file:./tests/.tmp/test.db";

/**
 * Builds a throwaway database from the real migrations before the suite runs.
 *
 * Using the actual migration files (via scripts/migrate.mjs) rather than
 * `db push` means the tests exercise the same schema that production gets —
 * including anything a migration does that the schema file alone wouldn't
 * reproduce.
 */
export default function setup() {
  rmSync(DB_DIR, { recursive: true, force: true });
  mkdirSync(DB_DIR, { recursive: true });

  execFileSync("node", ["scripts/migrate.mjs"], {
    env: { ...process.env, DATABASE_URL: DB_URL, TURSO_AUTH_TOKEN: "" },
    stdio: "pipe",
  });

  return () => {
    rmSync(DB_DIR, { recursive: true, force: true });
  };
}
