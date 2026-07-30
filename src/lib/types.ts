// Shared types used by both server and client components. Nothing in here may
// import a server-only module, or it would break the client bundle.

/**
 * Which list a show is on.
 *
 * - `watchlist` — added but never started
 * - `watching`  — at least one episode watched
 * - `paused`    — started, then set aside. Keeps its watch history but stays
 *                 out of Watching and out of Upcoming episodes.
 *
 * Distinct from "finished", which isn't a status at all — that's derived from
 * having watched every aired episode.
 */
export type TrackStatus = "watching" | "watchlist" | "paused";

export function isTrackStatus(value: unknown): value is TrackStatus {
  return value === "watching" || value === "watchlist" || value === "paused";
}
