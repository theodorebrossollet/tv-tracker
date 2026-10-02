"use client";

import { useOptimistic, useState, useTransition } from "react";

import { rateEpisode, rateMovie } from "@/app/rating-actions";
import { RATING_MAX, RATING_MIN } from "@/lib/ratings";

const STEPS = Array.from(
  { length: RATING_MAX - RATING_MIN + 1 },
  (_, i) => RATING_MIN + i,
);

/**
 * Ten tappable steps, 1 to 10. Tapping the chosen step clears the rating.
 *
 * The displayed rating derives from the prop via `useOptimistic`, so a server
 * revalidation can correct it. The error is plain state: optimistic values are
 * dropped when the transition ends, which would erase the message the moment
 * it appeared. Buttons are disabled while an action is pending, so a later tap
 * can only start once the earlier one has settled and the later one wins.
 */
export function RatingStrip({
  kind,
  id,
  rating,
}: {
  kind: "movie" | "episode";
  id: string;
  rating: number | null;
}) {
  const [current, setCurrent] = useOptimistic(rating);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(step: number) {
    const next = step === current ? null : step;

    setError(null);

    startTransition(async () => {
      setCurrent(next);

      const result =
        kind === "movie"
          ? await rateMovie(id, next)
          : await rateEpisode(id, next);

      // No manual rollback: the optimistic value is dropped when the
      // transition ends and the prop wins.
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div role="group" aria-label="Your rating" className="flex gap-1">
        {STEPS.map((step) => {
          const isCurrent = step === current;

          return (
            <button
              key={step}
              type="button"
              onClick={() => choose(step)}
              disabled={pending}
              aria-label={`Rate ${step} out of 10`}
              aria-pressed={isCurrent}
              className={`flex min-h-10 min-w-0 flex-1 items-center justify-center rounded-lg border text-sm font-medium transition-colors disabled:opacity-60 ${
                isCurrent
                  ? "border-accent bg-accent text-on-accent"
                  : "border-border hover:bg-surface"
              }`}
            >
              {step}
            </button>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}
