import Image from "next/image";
import Link from "next/link";

import { MarkWatchedButton } from "@/components/mark-watched-button";
import { ProfileButton } from "@/components/profile-button";
import { episodeCode, shortEpisodeCode } from "@/lib/episode-code";
import { formatRuntime, progressPercent } from "@/lib/format";
import { backdropUrl, posterUrl } from "@/lib/images";
import type { HeroShow } from "@/lib/watching";

/**
 * The top of the Watching screen: the show you're up to, full-bleed, with its
 * next episode and the button that marks it.
 *
 * It carries the screen's header (title and avatar) over the artwork, so the
 * page renders this *instead of* the plain header, not under it. It bleeds out
 * of `main`'s padding on three sides — the negative margins match
 * `px-4 pt-6 sm:px-6 sm:pt-10` in the layout — and gives the same back as
 * padding, so the text lines up with everything below.
 *
 * Artwork falls back from the 16:9 backdrop to the poster, cropped: a show
 * synced before backdrops were stored still gets a picture, just a tighter one.
 */
export function WatchingHero({
  show,
  nickname,
}: {
  show: HeroShow;
  nickname: string | null;
}) {
  const next = show.nextUnwatched;
  const art =
    backdropUrl(show.backdropPath, "w1280") ?? posterUrl(show.posterPath, "w500");
  const percent = progressPercent(show.watchedCount, show.airedCount);
  const detail = [next.name, next.runtime ? formatRuntime(next.runtime) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="relative -mx-4 -mt-6 px-4 pt-6 sm:-mx-6 sm:-mt-10 sm:px-6 sm:pt-10">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[460px] overflow-hidden bg-surface"
      >
        {art ? (
          <Image
            src={art}
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 1024px, 100vw"
            className="object-cover"
          />
        ) : null}
        {/* Dark at the top for the header, clear through the middle, and
            fully the page colour at the bottom, where the text sits. */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_55%,transparent)_0%,transparent_28%,color-mix(in_srgb,var(--background)_45%,transparent)_62%,var(--background)_100%)]" />
      </div>

      <div className="relative">
        <div className="flex items-center justify-between gap-2.5">
          <h1 className="text-[30px] font-bold tracking-[-0.03em]">Watching</h1>
          <ProfileButton nickname={nickname} />
        </div>

        <div className="mt-[176px] flex flex-col gap-2.5">
          <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em]">
            <span className="text-highlight">Up next</span>
            <span className="text-foreground/50" aria-hidden="true">
              ·
            </span>
            <span className="text-foreground/80">
              {shortEpisodeCode(next.seasonNumber, next.episodeNumber)}
            </span>
          </p>

          <h2 className="text-[42px] leading-none font-extrabold tracking-[-0.04em]">
            <Link href={`/show/${show.showId}`}>{show.name}</Link>
          </h2>

          {detail ? (
            <p className="text-[16px] text-foreground/85">{detail}</p>
          ) : null}

          <div className="mt-1 flex items-center gap-2.5">
            <div
              className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/20"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${show.name} progress`}
            >
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="text-[12px] font-medium tabular-nums text-foreground/75">
              {show.watchedCount} of {show.airedCount}
            </span>
          </div>

          <div className="mt-2 flex gap-2.5">
            <MarkWatchedButton
              episodeId={next.id}
              showName={show.name}
              code={episodeCode(next.seasonNumber, next.episodeNumber)}
              variant="wide"
            />
            <Link
              href={`/show/${show.showId}`}
              aria-label={`Open ${show.name}`}
              className="flex size-[50px] shrink-0 items-center justify-center rounded-full border border-accent-border bg-accent-tint text-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-5"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5M12 8h.01" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
