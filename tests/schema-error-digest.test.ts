import { mkdirSync, rmSync } from "node:fs";

import { PrismaLibSql } from "@prisma/adapter-libsql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { schemaMismatchDigest } from "@/lib/prisma";
import { SCHEMA_MISMATCH_DIGEST } from "@/lib/schema-error";

/**
 * The half of the stale-schema story that `toResult` never covered: a *page*
 * reading a column the database doesn't have. That throws during render, and
 * without a digest on the error the boundary blames TMDB — which is what
 * actually happened when `Settings.providerIds` shipped ahead of its
 * migration.
 *
 * Built against a database deliberately missing a column rather than a
 * hand-written error object, because the point is that the extension fires on
 * what the driver really throws.
 */
const DB_DIR = "tests/.tmp/digest";
const DB_URL = `file:./${DB_DIR}/incomplete.db`;

let prisma: ReturnType<typeof makeClient>;

function makeClient() {
  const adapter = new PrismaLibSql({ url: DB_URL, authToken: undefined });

  return new PrismaClient({ adapter }).$extends(schemaMismatchDigest);
}

beforeAll(async () => {
  rmSync(DB_DIR, { recursive: true, force: true });
  mkdirSync(DB_DIR, { recursive: true });

  prisma = makeClient();

  // A Settings table one migration behind: everything the older schema had,
  // and no `providerIds`.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Settings" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "notifyEnabled" BOOLEAN NOT NULL DEFAULT false,
      "country" TEXT
    )
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(DB_DIR, { recursive: true, force: true });
});

describe("a query against a database behind the code", () => {
  it("stamps the digest the error boundary reads", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const error = await prisma.settings
      .findUnique({ where: { userId: "anyone" } })
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(Error);
    expect((error as { digest?: string }).digest).toBe(SCHEMA_MISMATCH_DIGEST);

    vi.restoreAllMocks();
  });

  it("names the missing column in the log rather than the query", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      logged.push(String(line));
    });

    await prisma.settings
      .findUnique({ where: { userId: "anyone" } })
      .catch(() => {});

    vi.restoreAllMocks();

    const entry = logged.find((line) => line.includes("db.schema_mismatch"));
    expect(entry).toBeDefined();
    expect(entry).toContain("providerIds");
    // The rule this project keeps: a log line carries the column name, never
    // the invocation and its arguments.
    expect(entry).not.toContain("anyone");
  });

  it("leaves an unrelated failure alone", async () => {
    // A real constraint violation, not a schema problem — it must reach the
    // generic handling with no digest attached, or every database error would
    // start claiming the app is mid-update.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Settings" ("id", "userId") VALUES ('a', 'user-a')`,
    );

    const error = await prisma
      .$executeRawUnsafe(
        `INSERT INTO "Settings" ("id", "userId") VALUES ('a', 'user-b')`,
      )
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(Error);
    expect((error as { digest?: string }).digest).toBeUndefined();
  });
});
