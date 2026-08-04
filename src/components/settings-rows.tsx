import Link from "next/link";

/**
 * The grouped-row furniture the settings screen is built from.
 *
 * Plain server components with no state of their own — the interactive rows
 * pass their handlers in. Kept together so the 52px height, the hairline
 * divider and the 14px radius are stated once rather than in nine places.
 *
 * Note the cards use `surface` on the ordinary background rather than the
 * handoff's white-on-grey inversion. That inversion only pays off when the
 * whole screen carries the grouped background, which fights both the shared
 * document-scroll shell and the max-width the app uses on desktop — and the
 * Library and dashboard cards are already `surface`, so matching them is the
 * more consistent answer than giving one screen its own scheme.
 */
export function Group({
  label,
  description,
  children,
  footnote,
}: {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footnote?: React.ReactNode;
}) {
  return (
    <section className="mt-[22px] first:mt-5">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
        {label}
      </h2>

      {description ? (
        <p className="mt-[7px] text-[12.5px] leading-relaxed text-muted">
          {description}
        </p>
      ) : null}

      <div className="mt-2.5 divide-y divide-border-faint overflow-hidden rounded-[14px] border border-border bg-surface">
        {children}
      </div>

      {footnote ? (
        <p className="mx-0.5 mt-2 text-[11.5px] leading-relaxed text-faint">
          {footnote}
        </p>
      ) : null}
    </section>
  );
}

/** Shared geometry for every row, interactive or not. */
const ROW = "flex w-full items-center gap-3 px-3.5 min-h-[52px] text-[15px]";

/** A row that only states something, e.g. "Signed in as". */
export function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className={`${ROW} justify-between`}>
      {label}
      <span className="text-muted">{value}</span>
    </div>
  );
}

/** A row that navigates. */
export function LinkRow({
  label,
  value,
  href,
}: {
  label: string;
  value?: React.ReactNode;
  href: string;
}) {
  return (
    <Link href={href} className={`${ROW} justify-between`}>
      {label}
      <span className="flex items-center gap-[7px] text-muted">
        {value}
        <Chevron />
      </span>
    </Link>
  );
}

/** A row that runs something. */
export function ButtonRow({
  label,
  description,
  onClick,
  disabled,
  tone = "default",
}: {
  label: React.ReactNode;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${ROW} py-2.5 text-left transition-colors hover:bg-surface-sunken disabled:opacity-50 ${
        tone === "danger" ? "text-danger" : ""
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted">{description}</span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * A row that opens a panel beneath itself.
 *
 * `<details>` rather than a route or client state: the panel is static content
 * that belongs to this screen, the disclosure state is worth nothing after you
 * leave, and the element brings its own keyboard and assistive-tech behaviour.
 */
export function DisclosureRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group">
      <summary
        className={`${ROW} cursor-pointer list-none justify-between [&::-webkit-details-marker]:hidden`}
      >
        {label}
        <span className="text-muted transition-transform group-open:rotate-90">
          <Chevron />
        </span>
      </summary>
      <div className="border-t border-border-faint bg-surface-sunken px-3.5 py-3.5">
        {children}
      </div>
    </details>
  );
}

/**
 * The 40x24 switch.
 *
 * A real checkbox behind it rather than a button with `aria-checked`: the
 * native control is what assistive tech already understands, and hiding it
 * means the label has to carry the focus ring itself — the same trade
 * `ProviderSelect` documents.
 */
export function ToggleRow({
  label,
  description,
  logo,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  logo?: React.ReactNode;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`${ROW} cursor-pointer py-2.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-accent hover:bg-surface-sunken ${
        disabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      {logo}

      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted">{description}</span>
        ) : null}
      </span>

      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="sr-only"
      />

      <span
        aria-hidden="true"
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-icon-faint"
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] duration-200 ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </label>
  );
}

export function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 text-icon-faint"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
