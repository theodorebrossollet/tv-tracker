import { describe, expect, it } from "vitest";

import { isSchemaMismatch, missingSchemaObject } from "@/lib/schema-error";

// The shapes below were captured from a real Prisma client running against a
// database left one migration behind — not written from the documentation,
// which says P2021/P2022 and would have been wrong for both cases.

const missingColumnViaQuery = Object.assign(
  new Error(
    "Invalid `prisma.user.findUnique()` invocation\n\nDatabase error. Code: `1`. " +
      "Message: `SQLITE_ERROR: no such column: main.User.failedLogins`",
  ),
  {
    code: "P2039",
    meta: {
      modelName: "User",
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "1",
          originalMessage: "SQLITE_ERROR: no such column: main.User.failedLogins",
          kind: "sqlite",
        },
      },
    },
  },
);

const missingTableViaRaw = Object.assign(
  new Error("Raw query failed. Code: `1`. Message: `SQLITE_ERROR: no such table: Session`"),
  { code: "P2010" },
);

describe("isSchemaMismatch", () => {
  it("recognises a missing column and a missing table", () => {
    expect(isSchemaMismatch(missingColumnViaQuery)).toBe(true);
    expect(isSchemaMismatch(missingTableViaRaw)).toBe(true);
  });

  it("does not depend on the Prisma error code", () => {
    // The two real cases report P2039 and P2010 — neither is the documented
    // P2021/P2022, so a code-based check would miss both.
    expect(missingColumnViaQuery.code).toBe("P2039");
    expect(missingTableViaRaw.code).toBe("P2010");
  });

  it("leaves ordinary failures alone", () => {
    for (const other of [
      new Error("Unique constraint failed on the fields: (`nicknameKey`)"),
      Object.assign(new Error("Timed out fetching a connection"), { code: "P2024" }),
      new Error("fetch failed"),
      null,
      undefined,
      "a string",
    ]) {
      expect(isSchemaMismatch(other), String(other)).toBe(false);
    }
  });

  it("survives an error whose meta cannot be serialised", () => {
    const circular: Record<string, unknown> = { modelName: "User" };
    circular.self = circular;

    const error = Object.assign(
      new Error("Database error: no such column: main.User.lockedUntil"),
      { code: "P2039", meta: circular },
    );

    // The message alone still carries the signal.
    expect(isSchemaMismatch(error)).toBe(true);
  });
});

describe("missingSchemaObject", () => {
  it("names what is missing, for the log line", () => {
    expect(missingSchemaObject(missingColumnViaQuery)).toBe("main.User.failedLogins");
    expect(missingSchemaObject(missingTableViaRaw)).toBe("Session");
  });

  it("says so rather than throwing when it cannot tell", () => {
    expect(missingSchemaObject(new Error("something else"))).toBe("unknown");
  });
});
