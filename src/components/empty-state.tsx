type EmptyIcon = "shows" | "bookmark" | "archive";

interface EmptyStateProps {
  title: string;
  description: string;
  /**
   * Decorative glyph above the title. `aria-hidden` throughout — it restates
   * the title rather than adding to it.
   */
  icon?: EmptyIcon;
  /** Optional call to action, e.g. <FindShowButton />. */
  action?: React.ReactNode;
  /**
   * `panel` is a screen with nothing in it yet. `inline` is one empty section
   * of a screen that has other content — quieter, unfilled and without a
   * glyph, so it doesn't compete with the populated section above it.
   */
  variant?: "panel" | "inline";
}

/**
 * What a list says when it has nothing to show.
 *
 * Each one names what lands there and how it gets there, because "empty" on
 * its own reads as broken. Only the states you can act on get a button: an
 * empty Archive is not a problem to solve, so a call to action there would be
 * noise.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  variant = "panel",
}: EmptyStateProps) {
  if (variant === "inline") {
    return (
      <div className="rounded-2xl border border-dashed border-border px-5 py-[26px] text-center">
        <p className="text-[14.5px] font-medium">{title}</p>
        <p className="mx-auto mt-1.5 max-w-[250px] text-[12.5px] leading-relaxed text-muted">
          {description}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[18px] border border-dashed border-border bg-surface-sunken px-[22px] py-[34px] text-center">
      {icon ? (
        <div className="flex justify-center text-icon-faint">
          <Glyph icon={icon} />
        </div>
      ) : null}

      <p className={`text-base font-medium ${icon ? "mt-4" : ""}`}>{title}</p>
      <p className="mx-auto mt-[7px] max-w-[260px] text-[13px] leading-relaxed text-muted">
        {description}
      </p>

      {action ? <div className="mt-[18px]">{action}</div> : null}
    </div>
  );
}

function Glyph({ icon }: { icon: EmptyIcon }) {
  // Three tilted posters rather than an SVG: the shape being suggested is a
  // stack of poster cards, and building it from the same border and surface
  // tokens the real cards use keeps it in step with them.
  if (icon === "shows") {
    return (
      <span aria-hidden="true" className="flex justify-center gap-1.5">
        <span className="h-[39px] w-[26px] -rotate-6 rounded-[5px] border border-border bg-surface" />
        <span className="h-[39px] w-[26px] rounded-[5px] border border-border bg-border-faint" />
        <span className="h-[39px] w-[26px] rotate-6 rounded-[5px] border border-border bg-surface" />
      </span>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[34px]"
      aria-hidden="true"
    >
      {icon === "bookmark" ? (
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      ) : (
        <>
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
          <path d="M10 12h4" />
        </>
      )}
    </svg>
  );
}
