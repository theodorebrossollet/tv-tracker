-- CreateTable
CREATE TABLE "ShowRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "archivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShowRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShowRun_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArchivedEpisodeWatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "watchedAt" DATETIME NOT NULL,
    "rating" INTEGER,
    CONSTRAINT "ArchivedEpisodeWatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ShowRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArchivedEpisodeWatch_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PastMovieWatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "watchedAt" DATETIME NOT NULL,
    "rating" INTEGER,
    "archivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PastMovieWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PastMovieWatch_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ShowRun_userId_showId_runNumber_key" ON "ShowRun"("userId", "showId", "runNumber");

-- CreateIndex
CREATE INDEX "ArchivedEpisodeWatch_runId_idx" ON "ArchivedEpisodeWatch"("runId");

-- CreateIndex
CREATE INDEX "PastMovieWatch_userId_movieId_idx" ON "PastMovieWatch"("userId", "movieId");
