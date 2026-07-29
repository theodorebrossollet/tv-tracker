/**
 * Opening a show that isn't cached yet fetches it from TMDB — one request for
 * the show plus one per season, run sequentially to stay inside the rate limit.
 * For a long-running series that's a couple of seconds, which without this
 * looks like the app has frozen.
 *
 * Known trade-off: this file creates a Suspense boundary, so the shell streams
 * with a 200 before the page can call `notFound()`. An unknown show id
 * therefore renders the correct "Not found" page but with a 200 status rather
 * than 404 (measured: 404 without this file, 200 with it). Kept because the
 * loading state helps on every uncached show — the common path — while the
 * status code only matters to crawlers and uptime checks, and this app is
 * private with no SEO surface. Delete this file if that ever changes.
 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="h-[210px] w-[140px] shrink-0 rounded-md bg-surface" />

        <div className="min-w-0 flex-1 space-y-3">
          <div className="h-6 w-2/5 rounded bg-surface" />
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-surface" />
            <div className="h-3 w-11/12 rounded bg-surface" />
            <div className="h-3 w-3/4 rounded bg-surface" />
          </div>
          <div className="h-9 w-44 rounded-full bg-surface" />
        </div>
      </div>

      <div className="mt-8 space-y-2">
        <div className="h-5 w-32 rounded bg-surface" />
        <div className="h-40 w-full rounded-lg bg-surface" />
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        Loading show details from TMDB…
      </p>
    </div>
  );
}
