/**
 * Marks a search result as a movie or a show, as a small icon on its poster.
 *
 * Search now returns both, and the two can share a title. An icon on the poster
 * corner says which one at a glance without taking a word out of the title
 * row. It carries no colour on purpose: the kind is not a status, and the app
 * keeps colour for those.
 *
 * `role="img"` with a name, because the icon is the only thing that says which
 * kind a row is; the title attribute is there for a pointer, not for anyone who
 * needs the name.
 */
export function KindBadge({ kind }: { kind: "tv" | "movie" }) {
  const label = kind === "movie" ? "Movie" : "TV show";

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="absolute -bottom-1 -left-1 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-3"
      >
        {kind === "movie" ? (
          <>
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M8 4v16M16 4v16M4 8h4M4 12h16M4 16h4M16 8h4M16 16h4" />
          </>
        ) : (
          <>
            <rect x="3" y="7" width="18" height="13" rx="2" />
            <path d="m16 3-4 4-4-4" />
          </>
        )}
      </svg>
    </span>
  );
}
