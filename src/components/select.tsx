interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  // Not called `size`: that's a real HTML select attribute (number of visible
  // rows), and shadowing it with a string breaks the element's own typing.
  /** `sm` matches the availability picker, `md` the settings page. */
  scale?: "sm" | "md";
}

/**
 * A `<select>` with our own chevron.
 *
 * The native arrow is drawn by the OS at the very edge of the control, which
 * looks misaligned inside a `rounded-full` border — the corner curves away from
 * it. `appearance-none` removes it so we can position our own with real
 * padding, and it renders identically across browsers rather than differing per
 * platform.
 */
export function Select({
  scale = "sm",
  className = "",
  children,
  ...props
}: SelectProps) {
  // Both scales are 16px text. Anything smaller makes iOS Safari zoom the
  // viewport when the control takes focus, which crops the page and leaves the
  // reader pinching back out — a worse trade than a slightly larger chip, and
  // the bigger target suits a phone anyway.
  const padding =
    scale === "md" ? "py-2 pl-4 pr-9 text-base" : "py-1.5 pl-3 pr-8 text-base";

  return (
    <span className="relative inline-flex items-center">
      <select
        {...props}
        className={`appearance-none rounded-full border border-border bg-background text-foreground outline-none focus:border-accent disabled:opacity-50 ${padding} ${className}`}
      >
        {children}
      </select>

      {/* pointer-events-none so clicks fall through to the select itself. */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`pointer-events-none absolute text-muted ${
          scale === "md" ? "right-3.5 size-4" : "right-3 size-3.5"
        }`}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}
