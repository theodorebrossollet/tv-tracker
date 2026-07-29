import Link from "next/link";

/** Reached by notFound() on a show page when TMDB doesn't recognise the id. */
export default function NotFound() {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="font-medium">Not found</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        That show doesn&rsquo;t exist on TMDB, or the link is wrong.
      </p>

      <Link
        href="/"
        className="mt-4 inline-block rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Back to Watching
      </Link>
    </div>
  );
}
