-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codeHash" TEXT NOT NULL,
    "passwordHash" TEXT,
    "nickname" TEXT,
    "nicknameKey" TEXT,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("codeHash", "createdAt", "id", "nickname", "nicknameKey", "passwordHash") SELECT "codeHash", "createdAt", "id", "nickname", "nicknameKey", "passwordHash" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_codeHash_key" ON "User"("codeHash");
CREATE UNIQUE INDEX "User_nicknameKey_key" ON "User"("nicknameKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
