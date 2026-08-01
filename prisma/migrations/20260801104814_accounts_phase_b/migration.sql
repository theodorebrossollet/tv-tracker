/*
  Warnings:

  - The primary key for the `Settings` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `Settings` table. All the data in the column will be lost.
  - Made the column `userId` on table `Settings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `userId` on table `TrackedShow` required. This step will fail if there are existing NULL values in that column.
  - Made the column `userId` on table `WatchedEpisode` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "notifyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "country" TEXT,
    CONSTRAINT "Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Settings" ("country", "notifyEnabled", "userId") SELECT "country", "notifyEnabled", "userId" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE TABLE "new_TrackedShow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "showId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedShow_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackedShow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TrackedShow" ("addedAt", "id", "showId", "status", "userId") SELECT "addedAt", "id", "showId", "status", "userId" FROM "TrackedShow";
DROP TABLE "TrackedShow";
ALTER TABLE "new_TrackedShow" RENAME TO "TrackedShow";
CREATE INDEX "TrackedShow_showId_idx" ON "TrackedShow"("showId");
CREATE UNIQUE INDEX "TrackedShow_userId_showId_key" ON "TrackedShow"("userId", "showId");
CREATE TABLE "new_WatchedEpisode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "episodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "watchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchedEpisode_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WatchedEpisode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WatchedEpisode" ("episodeId", "id", "userId", "watchedAt") SELECT "episodeId", "id", "userId", "watchedAt" FROM "WatchedEpisode";
DROP TABLE "WatchedEpisode";
ALTER TABLE "new_WatchedEpisode" RENAME TO "WatchedEpisode";
CREATE INDEX "WatchedEpisode_episodeId_idx" ON "WatchedEpisode"("episodeId");
CREATE UNIQUE INDEX "WatchedEpisode_userId_episodeId_key" ON "WatchedEpisode"("userId", "episodeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
