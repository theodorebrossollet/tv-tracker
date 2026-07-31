import type { TrackStatus } from "@/lib/types";

const LABELS: Record<TrackStatus, string> = {
  watching: "Watching",
  watchlist: "Watchlist",
  paused: "Paused",
  stopped: "Stopped",
};

/**
 * Says which list a show is already on.
 *
 * Exists because a tick alone is ambiguous once there is more than one way to
 * be tracked: search results showed a filled check for a paused show with
 * nothing to say why.
 *
 * Only `watching` is tinted. The others are states you've set aside or not
 * started, and colouring all four would turn a list of results into a
 * traffic-light display.
 */
export function StatusBadge({ status }: { status: TrackStatus | null }) {
  if (!status) return null;

  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-normal ${
        status === "watching"
          ? "border-accent/40 text-accent"
          : "border-border text-muted"
      }`}
    >
      {LABELS[status]}
    </span>
  );
}
