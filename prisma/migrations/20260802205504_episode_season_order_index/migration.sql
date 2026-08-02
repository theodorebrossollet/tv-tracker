-- DropIndex
DROP INDEX "Episode_showId_idx";

-- CreateIndex
CREATE INDEX "Episode_showId_seasonNumber_episodeNumber_idx" ON "Episode"("showId", "seasonNumber", "episodeNumber");
