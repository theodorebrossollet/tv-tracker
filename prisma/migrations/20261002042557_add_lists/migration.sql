-- CreateTable
CREATE TABLE "List" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trackSeparately" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "List_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listId" TEXT NOT NULL,
    "movieId" TEXT,
    "showId" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "watchedAt" DATETIME,
    CONSTRAINT "ListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ListItem_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ListItem_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "List_userId_createdAt_idx" ON "List"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ListItem_movieId_idx" ON "ListItem"("movieId");

-- CreateIndex
CREATE INDEX "ListItem_showId_idx" ON "ListItem"("showId");

-- CreateIndex
CREATE UNIQUE INDEX "ListItem_listId_movieId_key" ON "ListItem"("listId", "movieId");

-- CreateIndex
CREATE UNIQUE INDEX "ListItem_listId_showId_key" ON "ListItem"("listId", "showId");
