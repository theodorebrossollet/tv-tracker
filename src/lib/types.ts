// Shared types used by both server and client components. Nothing in here may
// import a server-only module, or it would break the client bundle.

/**
 * Which list a show is on.
 *
 * - `watchlist` — added but never started
 * - `watching`  — at least one episode watched
 * - `paused`    — started, then set aside, but you mean to come back
 * - `stopped`   — started, then abandoned for good
 *
 * `paused` and `stopped` behave identically in the data model; the difference
 * is intent, which is what makes the two lists worth scanning separately later.
 *
 * "Finished" is deliberately **not** a status. It's derived from having watched
 * every aired episode, so a show you completed drops back into Watching by
 * itself when a new season airs — which a stored status would not do.
 */
export type TrackStatus = "watching" | "watchlist" | "paused" | "stopped";

const STATUSES: readonly TrackStatus[] = [
  "watching",
  "watchlist",
  "paused",
  "stopped",
];

export function isTrackStatus(value: unknown): value is TrackStatus {
  return STATUSES.includes(value as TrackStatus);
}

/** Statuses that mean "set aside", as opposed to active or planned. */
export const INACTIVE_STATUSES = ["paused", "stopped"] as const;
