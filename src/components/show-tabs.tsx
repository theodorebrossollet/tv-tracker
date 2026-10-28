import Link from "next/link";

import { SeasonActions } from "@/app/show/[id]/season-actions";
import {
  SEASON_PARAM,
  SHOW_TABS,
  TAB_PARAM,
  showHref,
  type ShowTab,
} from "@/lib/show-tabs";

type Params = Record<string, string | string[] | undefined>;

const TAB_LABELS: Record<ShowTab, string> = {
  episodes: "Episodes",
  watch: "Watch",
  about: "About",
};

/**
 * Episodes / Watch / About.
 *
 * Links, not buttons: each tab is a real URL that renders only its own panel,
 * which is what lets the Watch and About fetches be skipped entirely when the
 * Episodes tab is the one being asked for. The season travels along in the
 * query string, so switching tab and coming back doesn't lose your place.
 */
export function ShowSegments({
  active,
  params,
}: {
  active: ShowTab;
  params: Params;
}) {
  return (
    // Underlined text tabs, the Marquee look: a segmented control's sunken
    // track read as a form widget under a full-bleed header.
    <div className="flex gap-6 border-b border-border">
      {SHOW_TABS.map((tab) => {
        const current = tab === active;

        return (
          <Link
            key={tab}
            // `replace`, so Back leaves the show page rather than stepping
            // backwards through tabs you have already read.
            replace
            scroll={false}
            href={showHref(params, { [TAB_PARAM]: tab })}
            aria-current={current ? "page" : undefined}
            className={`-mb-px flex min-h-11 items-center border-b-2 text-[15px] font-semibold transition-colors ${
              current
                ? "border-foreground text-foreground"
                : "border-transparent text-faint hover:text-muted"
            }`}
          >
            {TAB_LABELS[tab]}
          </Link>
        );
      })}
    </div>
  );
}

export interface SeasonSummary {
  seasonNumber: number;
  /** Aired episodes still unwatched — the pill, hidden at zero. */
  unwatched: number;
  /** Whether anything in it has aired, which decides if "Mark all" applies. */
  hasAired: boolean;
  allWatched: boolean;
}

/**
 * The season strip, plus the bulk mark control for the season on screen.
 *
 * Horizontally scrollable with snap points: a show with ten seasons overflows
 * 390px, and a strip that stops halfway through a tab reads as broken.
 */
export function SeasonTabs({
  showId,
  seasons,
  active,
  params,
}: {
  showId: string;
  seasons: SeasonSummary[];
  active: number;
  params: Params;
}) {
  const current = seasons.find((season) => season.seasonNumber === active);

  return (
    <div className="flex items-center gap-2">
      <div className="-mx-4 flex min-w-0 flex-1 snap-x snap-mandatory gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {seasons.map((season) => {
          const selected = season.seasonNumber === active;

          return (
            <Link
              key={season.seasonNumber}
              replace
              scroll={false}
              href={showHref(params, { [SEASON_PARAM]: season.seasonNumber })}
              aria-current={selected ? "page" : undefined}
              className={`flex min-h-[38px] shrink-0 snap-start items-center gap-1.5 rounded-[10px] border px-3 text-[13px] transition-colors ${
                selected
                  ? "border-accent-border bg-accent-tint text-accent-deep"
                  : "border-border text-muted"
              }`}
            >
              S{season.seasonNumber}
              {season.unwatched > 0 ? (
                <span
                  className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                    selected
                      ? "bg-accent-tint text-accent-deep"
                      : "bg-surface-sunken text-faint"
                  }`}
                >
                  {season.unwatched}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      {current?.hasAired ? (
        <SeasonActions
          showId={showId}
          seasonNumber={active}
          allWatched={current.allWatched}
        />
      ) : null}
    </div>
  );
}
