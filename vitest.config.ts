import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    // The database-backed tests share one SQLite file and truncate between
    // cases, so they must not run concurrently.
    fileParallelism: false,
    env: {
      // Set before any module loads, because src/lib/prisma.ts reads this at
      // import time. Kept well away from dev.db so a test run can never touch
      // real tracking data.
      DATABASE_URL: "file:./tests/.tmp/test.db",
      TMDB_API_KEY: "test-key-not-a-real-one",
      NODE_ENV: "test",
    },
  },
  resolve: {
    alias: [
      // `server-only` throws when imported outside a React Server Component.
      // Tests import these modules directly, so it's stubbed out.
      {
        find: /^server-only$/,
        replacement: fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url)),
      },
      { find: /^@\/(.*)$/, replacement: `${src}/$1` },
    ],
  },
});
