-- CreateTable
CREATE TABLE "Movie" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "posterPath" TEXT,
    "overview" TEXT,
    "lastSynced" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT,
    "createdAt" DATETIME,
    "releaseDate" DATETIME,
    "runtime" INTEGER,
    "status" TEXT,
    "genres" TEXT
);

-- CreateTable
CREATE TABLE "TrackedMovie" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "movieId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "watchedAt" DATETIME,
    CONSTRAINT "TrackedMovie_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackedMovie_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Movie_addedById_createdAt_idx" ON "Movie"("addedById", "createdAt");

-- CreateIndex
CREATE INDEX "TrackedMovie_movieId_idx" ON "TrackedMovie"("movieId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedMovie_userId_movieId_key" ON "TrackedMovie"("userId", "movieId");
