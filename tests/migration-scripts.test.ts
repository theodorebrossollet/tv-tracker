import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@libsql/client";

import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { resetDatabase } from "./helpers";

// These run the real scripts as subprocesses against the same throwaway
// database the rest of the suite uses. Importing their logic instead would test
// a copy of it: the scripts are plain .mjs run by hand against production, and
// what matters is that *those files* behave, including their exit codes.

const DB_URL = "file:./tests/.tmp/test.db";

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(script: string): RunResult {
  try {
    const stdout = execFileSync("node", [`scripts/${script}`], {
      env: { ...process.env, DATABASE_URL: DB_URL, TURSO_AUTH_TOKEN: "" },
      encoding: "utf8",
      stdio: "pipe",
    });

    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return {
      status: failure.status,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

const createAdmin = () => run("create-admin-user.mjs");
const createUser = () => run("create-user.mjs");

/** The code is printed once and never stored — this is the only way to read it. */
function codeFrom(stdout: string): string {
  const match = stdout.match(/Code:\s+([0-9a-f]+)/);
  if (!match) throw new Error(`No code in output:\n${stdout}`);
  return match[1];
}

// The backfill runs against the *pre-Phase-B* schema, where `userId` is
// nullable — the state production sits in between the two migrations, and the
// state this script exists to resolve. Phase B makes that state unreachable, so
// these tests build their own database from the migration files up to (but not
// including) Phase B rather than using the suite's shared one.
//
// The script still has one real production run left: it is re-run immediately
// before Phase B to catch rows written in the gap. That is why this coverage is
// worth keeping rather than deleting along with the schema it targets.
const LEGACY_DB = "tests/.tmp/pre-phase-b.db";
const LEGACY_URL = `file:./${LEGACY_DB}`;

async function buildPrePhaseBDatabase() {
  rmSync(LEGACY_DB, { force: true });

  const client = createClient({ url: LEGACY_URL });

  const migrations = readdirSync("prisma/migrations")
    .filter((entry) => !entry.endsWith(".toml"))
    .sort();

  for (const name of migrations) {
    if (name.includes("accounts_phase_b")) break;
    await client.executeMultiple(
      readFileSync(join("prisma/migrations", name, "migration.sql"), "utf8"),
    );
  }

  return client;
}

/** Rows as v1 wrote them: real data, no owner. */
async function seedV1Data(client: Awaited<ReturnType<typeof buildPrePhaseBDatabase>>) {
  await client.execute(
    `INSERT INTO Show (id, name, lastSynced) VALUES ('1396', 'Breaking Bad', '2026-01-01')`,
  );
  await client.execute(
    `INSERT INTO Episode (id, showId, seasonNumber, episodeNumber) VALUES ('e1', '1396', 1, 1)`,
  );
  await client.execute(
    `INSERT INTO TrackedShow (id, showId, status, addedAt) VALUES ('t1', '1396', 'watching', '2026-01-01')`,
  );
  await client.execute(
    `INSERT INTO WatchedEpisode (id, episodeId, watchedAt) VALUES ('w1', 'e1', '2026-01-01')`,
  );
  await client.execute(
    `INSERT INTO Settings (id, notifyEnabled, country) VALUES (1, 1, 'FR')`,
  );
}

function runAgainstLegacy(script: string): RunResult {
  try {
    const stdout = execFileSync("node", [`scripts/${script}`], {
      env: { ...process.env, DATABASE_URL: LEGACY_URL, TURSO_AUTH_TOKEN: "" },
      encoding: "utf8",
      stdio: "pipe",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return {
      status: failure.status,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

const ownerlessTrackedShows = async (
  client: Awaited<ReturnType<typeof buildPrePhaseBDatabase>>,
) => {
  const rows = await client.execute(
    "SELECT count(*) AS n FROM TrackedShow WHERE userId IS NULL",
  );
  return Number(rows.rows[0].n);
};

beforeEach(async () => {
  await resetDatabase();
});

describe("create-admin-user", () => {
  it("creates one user and prints a code that matches the stored hash", () => {
    const result = createAdmin();
    expect(result.status).toBe(0);

    const code = codeFrom(result.stdout);

    // 16 random bytes as hex — the format decided in the design doc.
    expect(code).toMatch(/^[0-9a-f]{32}$/);

    return expect(
      prisma.user.findMany({ select: { codeHash: true, nickname: true } }),
    ).resolves.toEqual([
      {
        codeHash: createHash("sha256").update(code).digest("hex"),
        // Chosen at first login, not here.
        nickname: null,
      },
    ]);
  });

  it("never stores the code itself", async () => {
    const code = codeFrom(createAdmin().stdout);
    const user = await prisma.user.findFirstOrThrow();

    expect(JSON.stringify(user)).not.toContain(code);
  });

  it("refuses to create a second account", async () => {
    expect(createAdmin().status).toBe(0);

    const second = createAdmin();

    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain("already exists");
    // The guard is the point: a second user here would leave one account
    // holding all the backfilled data and no way to tell which is which.
    await expect(prisma.user.count()).resolves.toBe(1);
  });
});

describe("create-user", () => {
  it("creates an account and prints a code matching the stored hash", async () => {
    const result = createUser();
    expect(result.status).toBe(0);

    const code = codeFrom(result.stdout);
    expect(code).toMatch(/^[0-9a-f]{32}$/);

    await expect(
      prisma.user.findMany({
        select: { codeHash: true, nickname: true, passwordHash: true },
      }),
    ).resolves.toEqual([
      {
        codeHash: createHash("sha256").update(code).digest("hex"),
        // Both chosen by the recipient at first login, not here.
        nickname: null,
        passwordHash: null,
      },
    ]);
  });

  it("creates as many accounts as it is run, each with its own code", async () => {
    // The opposite of create-admin-user, which refuses a second run. This is
    // the script for inviting people, so running it repeatedly is the point.
    const codes = [createUser(), createUser(), createUser()].map((r) =>
      codeFrom(r.stdout),
    );

    expect(new Set(codes).size).toBe(3);
    await expect(prisma.user.count()).resolves.toBe(3);
  });

  it("never stores the code itself", async () => {
    const code = codeFrom(createUser().stdout);
    const user = await prisma.user.findFirstOrThrow();

    expect(JSON.stringify(user)).not.toContain(code);
  });

  it("makes an account that can actually be used", async () => {
    // The code has to survive hashing and round-trip through login, otherwise
    // this script mints accounts nobody can get into.
    const code = codeFrom(createUser().stdout);

    await expect(
      prisma.user.findUnique({
        where: { codeHash: createHash("sha256").update(code).digest("hex") },
        select: { id: true },
      }),
    ).resolves.not.toBeNull();
  });
});

describe("backfill-user-ownership", () => {
  let db: Awaited<ReturnType<typeof buildPrePhaseBDatabase>>;

  beforeEach(async () => {
    db = await buildPrePhaseBDatabase();
    await seedV1Data(db);
  });

  const userId = async () =>
    String((await db.execute("SELECT id FROM User LIMIT 1")).rows[0].id);

  it("assigns every ownerless row to the single user", async () => {
    runAgainstLegacy("create-admin-user.mjs");

    expect(runAgainstLegacy("backfill-user-ownership.mjs").status).toBe(0);

    const id = await userId();
    for (const table of ["TrackedShow", "WatchedEpisode", "Settings"]) {
      const rows = await db.execute(`SELECT userId FROM "${table}"`);
      expect(rows.rows.map((row) => row.userId), table).toEqual([id]);
    }

    // Settings keeps its values — Phase B's rebuild copies this column across.
    const settings = await db.execute("SELECT country FROM Settings");
    expect(settings.rows[0].country).toBe("FR");
  });

  it("picks up rows written after an earlier run", async () => {
    // The Phase A → Phase B gap: the old build stays live and keeps writing
    // rows with no owner. Without a re-run immediately before Phase B, these
    // are exactly the rows that make NOT NULL fail.
    runAgainstLegacy("create-admin-user.mjs");
    runAgainstLegacy("backfill-user-ownership.mjs");

    await db.execute(
      `INSERT INTO Show (id, name, lastSynced) VALUES ('1399', 'Thrones', '2026-01-01')`,
    );
    await db.execute(
      `INSERT INTO TrackedShow (id, showId, status, addedAt) VALUES ('t2', '1399', 'watchlist', '2026-01-01')`,
    );

    expect(await ownerlessTrackedShows(db)).toBe(1);
    expect(runAgainstLegacy("backfill-user-ownership.mjs").status).toBe(0);
    expect(await ownerlessTrackedShows(db)).toBe(0);
  });

  it("is a no-op when everything already has an owner", async () => {
    runAgainstLegacy("create-admin-user.mjs");
    runAgainstLegacy("backfill-user-ownership.mjs");

    const second = runAgainstLegacy("backfill-user-ownership.mjs");

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Nothing to do");
  });

  it("refuses to run before an account exists", async () => {
    const result = runAgainstLegacy("backfill-user-ownership.mjs");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("No users exist");
    expect(await ownerlessTrackedShows(db)).toBe(1);
  });

  it("refuses to guess when more than one account exists", async () => {
    runAgainstLegacy("create-admin-user.mjs");
    await db.execute(
      `INSERT INTO User (id, codeHash, createdAt) VALUES ('u2', 'another-hash', '2026-01-02')`,
    );

    const result = runAgainstLegacy("backfill-user-ownership.mjs");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("refusing to guess");
    // Nothing assigned — leaving a row ownerless is recoverable, handing one
    // person's library to the wrong account is not.
    expect(await ownerlessTrackedShows(db)).toBe(1);
  });
});
