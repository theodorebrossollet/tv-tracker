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

function run(script: string, ...args: string[]): RunResult {
  try {
    const stdout = execFileSync("node", [`scripts/${script}`, ...args], {
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

const createUser = () => run("create-user.mjs");
const resetCode = (...args: string[]) => run("reset-user-code.mjs", ...args);

/** The code is printed once and never stored — this is the only way to read it. */
function codeFrom(stdout: string): string {
  const match = stdout.match(/Code:\s+([0-9a-f]+)/);
  if (!match) throw new Error(`No code in output:\n${stdout}`);
  return match[1];
}

/** Same idea, for reset-user-code.mjs's "New code:" line. */
function newCodeFrom(stdout: string): string {
  const match = stdout.match(/New code:\s+([0-9a-f]+)/);
  if (!match) throw new Error(`No code in output:\n${stdout}`);
  return match[1];
}

beforeEach(async () => {
  await resetDatabase();
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
    // It has no "first account only" guard: each run is a separate account.
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

describe("reset-user-code", () => {
  it("issues a new code that replaces the old one", async () => {
    const oldCode = codeFrom(createUser().stdout);
    const oldHash = createHash("sha256").update(oldCode).digest("hex");

    await prisma.user.update({
      where: { codeHash: oldHash },
      data: { nickname: "Theo", nicknameKey: "theo" },
    });

    const result = resetCode("Theo");
    expect(result.status).toBe(0);

    const newCode = newCodeFrom(result.stdout);
    expect(newCode).not.toBe(oldCode);

    // The old code is dead; the new one resolves to an account.
    await expect(
      prisma.user.findUnique({ where: { codeHash: oldHash } }),
    ).resolves.toBeNull();
    await expect(
      prisma.user.findUnique({
        where: { codeHash: createHash("sha256").update(newCode).digest("hex") },
      }),
    ).resolves.not.toBeNull();
  });

  it("changes the code without touching the account's id or password", async () => {
    const oldCode = codeFrom(createUser().stdout);
    const before = await prisma.user.findUniqueOrThrow({
      where: { codeHash: createHash("sha256").update(oldCode).digest("hex") },
    });

    await prisma.user.update({
      where: { id: before.id },
      data: {
        nickname: "Theo",
        nicknameKey: "theo",
        // A real-looking hash, not null — proves a reset leaves an already
        // chosen password alone rather than forcing it back through onboarding.
        passwordHash: "scrypt$32768$8$1$aa$bb",
      },
    });

    expect(resetCode("Theo").status).toBe(0);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });

    // Same row — this is what makes every TrackedShow/WatchedEpisode/Settings
    // row (all keyed on `id`) survive a reset untouched.
    expect(after.id).toBe(before.id);
    expect(after.passwordHash).toBe("scrypt$32768$8$1$aa$bb");
    expect(after.codeHash).not.toBe(before.codeHash);
  });

  it("matches the nickname case-insensitively", async () => {
    const code = codeFrom(createUser().stdout);
    await prisma.user.update({
      where: { codeHash: createHash("sha256").update(code).digest("hex") },
      data: { nickname: "Theo", nicknameKey: "theo" },
    });

    expect(resetCode("tHEO").status).toBe(0);
  });

  it("refuses without a nickname argument", () => {
    const result = resetCode();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Usage:");
  });

  it("refuses when no account has that nickname", async () => {
    const result = resetCode("nobody");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("No account found");
  });

  it("never prints the old code, only the new one", async () => {
    const oldCode = codeFrom(createUser().stdout);
    await prisma.user.update({
      where: { codeHash: createHash("sha256").update(oldCode).digest("hex") },
      data: { nickname: "Theo", nicknameKey: "theo" },
    });

    const result = resetCode("Theo");
    expect(result.stdout).not.toContain(oldCode);
  });
});
