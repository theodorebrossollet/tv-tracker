import Link from "next/link";
import { notFound } from "next/navigation";

import { AddTitlesButton } from "@/components/add-titles-button";
import { EmptyState } from "@/components/empty-state";
import { ListItemRow } from "@/components/list-item-row";
import { ListMenu } from "@/components/list-menu";
import { PosterGrid } from "@/components/poster-grid";
import { ViewToggle } from "@/components/view-toggle";
import { requireOnboardedSession } from "@/lib/auth";
import { getViewMode } from "@/lib/get-view-mode";
import { getListDetail, type ListItemView } from "@/lib/queries";
import type { ViewMode } from "@/lib/view-mode";

export const dynamic = "force-dynamic";

interface ListPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: ListPageProps) {
  const { id } = await params;
  // Gated before any read, like the movie page: metadata runs ahead of the
  // component and must not reveal a list's name without a session. A foreign
  // list reads as null, so it gets the same fallback as an unknown one.
  const { user } = await requireOnboardedSession();
  const list = await getListDetail(user.id, id);

  return { title: list ? `${list.name} · TV Tracker` : "List · TV Tracker" };
}

export default async function ListPage({ params }: ListPageProps) {
  const { id } = await params;
  const { user } = await requireOnboardedSession();

  // List ids are opaque, so there is nothing to validate up front. A list that
  // belongs to someone else comes back null exactly like one that never
  // existed, which is what keeps the two indistinguishable.
  const list = await getListDetail(user.id, id);
  if (!list) notFound();
  const view = await getViewMode();

  // `items` arrives sorted not-watched first; filtering keeps that order.
  const toWatch = list.items.filter((item) => !item.watched);
  const watched = list.items.filter((item) => item.watched);

  return (
    <div className="pb-6 pt-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/lists"
          aria-label="Back"
          className="-ml-2 flex size-10 items-center justify-center rounded-full"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-[19px]"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>

        <ListMenu
          list={{
            id: list.id,
            name: list.name,
            trackSeparately: list.trackSeparately,
          }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <h1 className="min-w-0 break-words text-[25px] font-semibold tracking-[-0.025em]">
          {list.name}
        </h1>
        {list.items.length > 0 ? (
          <div className="flex shrink-0 items-center gap-2">
            <ViewToggle view={view} />
            <AddTitlesButton listId={list.id} listName={list.name} />
          </div>
        ) : null}
      </div>

      <div className="mt-[18px]">
        {list.items.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description="Search for shows and movies to put in this list."
            icon="list"
            action={<AddTitlesButton listId={list.id} listName={list.name} />}
          />
        ) : (
          <>
            {toWatch.length > 0 ? (
              <ItemSection
                listId={list.id}
                trackSeparately={list.trackSeparately}
                items={toWatch}
                view={view}
              />
            ) : null}

            {watched.length > 0 ? (
              <section className={toWatch.length > 0 ? "mt-7" : ""}>
                <h2 className="mb-2.5 text-[13px] font-semibold tracking-[-0.01em] text-muted">
                  Watched
                </h2>
                <ItemSection
                  listId={list.id}
                  trackSeparately={list.trackSeparately}
                  items={watched}
                  view={view}
                />
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One run of a list's titles, all of them: a list is something you scan, and
 * `MAX_ITEMS_PER_LIST` keeps it bounded, so there is no "show more" here (the
 * Library's sections, which have no such cap, still page).
 */
function ItemSection({
  listId,
  trackSeparately,
  items,
  view,
}: {
  listId: string;
  trackSeparately: boolean;
  items: ListItemView[];
  view: ViewMode;
}) {
  return view === "posters" ? (
    <PosterGrid
      items={items.map((item) => ({
        key: item.itemId,
        href: `${item.kind === "movie" ? "/movie" : "/show"}/${item.titleId}`,
        title: item.title,
        posterPath: item.posterPath,
        kind: item.kind === "movie" ? "movie" : "tv",
        seen: item.watched,
        rating: item.rating,
        ratingIsAverage: item.kind === "show",
        quiet: item.watched,
      }))}
    />
  ) : (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <ListItemRow
          key={item.itemId}
          listId={listId}
          trackSeparately={trackSeparately}
          item={item}
        />
      ))}
    </ul>
  );
}
