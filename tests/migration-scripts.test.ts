import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

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
const backfill = () => run("backfill-user-ownership.mjs");

/** The code is printed once and never stored — this is the only way to read it. */
function codeFrom(stdout: string): string {
  const match = stdout.match(/Code:\s+([0-9a-f]+)/);
  if (!match) throw new Error(`No code in output:\n${stdout}`);
  return match[1];
}

/** Rows as v1 wrote them: real data, no owner. */
async function seedV1Data() {
  await prisma.show.create({ data: { id: "1396", name: "Breaking Bad" } });
  await prisma.episode.createMany({
    data: [
      { id: "e1", showId: "1396", seasonNumber: 1, episodeNumber: 1 },
      { id: "e2", showId: "1396", seasonNumber: 1, episodeNumber: 2 },
    ],
  });
  await prisma.trackedShow.create({
    data: { id: "t1", showId: "1396", status: "watching" },
  });
  await prisma.watchedEpisode.create({ data: { id: "w1", episodeId: "e1" } });
  await prisma.settings.create({ data: { id: 1, country: "FR" } });
}

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

describe("backfill-user-ownership", () => {
  it("assigns every ownerless row to the single user", async () => {
    await seedV1Data();
    createAdmin();

    expect(backfill().status).toBe(0);

    const { id: userId } = await prisma.user.findFirstOrThrow();

    await expect(
      prisma.trackedShow.findMany({ select: { userId: true } }),
    ).resolves.toEqual([{ userId }]);
    await expect(
      prisma.watchedEpisode.findMany({ select: { userId: true } }),
    ).resolves.toEqual([{ userId }]);
    await expect(
      prisma.settings.findMany({ select: { userId: true, country: true } }),
    ).resolves.toEqual([{ userId, country: "FR" }]);
  });

  it("picks up rows written after an earlier run", async () => {
    // The Phase A → Phase B gap: v1 stays live and keeps writing rows with no
    // owner. Without a re-run immediately before Phase B, these are exactly the
    // rows that make NOT NULL fail.
    await seedV1Data();
    createAdmin();
    backfill();

    await prisma.show.create({ data: { id: "1399", name: "Thrones" } });
    await prisma.trackedShow.create({
      data: { id: "t2", showId: "1399", status: "watchlist" },
    });

    const second = backfill();
    expect(second.status).toBe(0);

    const { id: userId } = await prisma.user.findFirstOrThrow();
    await expect(
      prisma.trackedShow.count({ where: { userId: null } }),
    ).resolves.toBe(0);
    await expect(
      prisma.trackedShow.findMany({ select: { userId: true } }),
    ).resolves.toEqual([{ userId }, { userId }]);
  });

  it("is a no-op when everything already has an owner", async () => {
    await seedV1Data();
    createAdmin();
    backfill();

    const before = await prisma.trackedShow.findMany();
    const second = backfill();

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Nothing to do");
    await expect(prisma.trackedShow.findMany()).resolves.toEqual(before);
  });

  it("refuses to run before an account exists", async () => {
    await seedV1Data();

    const result = backfill();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("No users exist");
    await expect(
      prisma.trackedShow.count({ where: { userId: null } }),
    ).resolves.toBe(1);
  });

  it("refuses to guess when more than one account exists", async () => {
    await seedV1Data();
    createAdmin();

    // A second account, as create-user.mjs will later produce.
    await prisma.user.create({ data: { id: "u2", codeHash: "another-hash" } });

    const result = backfill();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("refusing to guess");
    // Nothing assigned — leaving it ownerless is recoverable, handing one
    // person's library to the wrong account is not.
    await expect(
      prisma.trackedShow.count({ where: { userId: null } }),
    ).resolves.toBe(1);
  });
});
