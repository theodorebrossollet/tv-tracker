import { PrismaLibSql } from "@prisma/adapter-libsql";

import { PrismaClient } from "@/generated/prisma/client";

// One adapter covers both environments, because libSQL speaks plain SQLite
// files as well as Turso's remote protocol:
//
//   local dev    DATABASE_URL="file:./dev.db"        (no auth token)
//   production   DATABASE_URL="libsql://….turso.io"  (+ TURSO_AUTH_TOKEN)
//
// Turso is what makes deploying to Vercel possible at all: Vercel's filesystem
// is read-only outside /tmp, so a local SQLite file there can be read but never
// written to.

// Next.js hot-reloads modules in dev, which would otherwise open a new database
// connection on every reload until the process runs out of handles. Stashing the
// client on globalThis keeps a single instance across reloads.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (url.startsWith("libsql://") && !authToken) {
    throw new Error(
      "DATABASE_URL points at Turso but TURSO_AUTH_TOKEN is not set.",
    );
  }

  const adapter = new PrismaLibSql({ url, authToken });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
