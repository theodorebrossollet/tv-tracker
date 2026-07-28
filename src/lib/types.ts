// Shared types used by both server and client components. Nothing in here may
// import a server-only module, or it would break the client bundle.

export type TrackStatus = "watching" | "watchlist";

export function isTrackStatus(value: unknown): value is TrackStatus {
  return value === "watching" || value === "watchlist";
}
