import Link from "next/link";
import { notFound } from "next/navigation";

import { AddTitlesButton } from "@/components/add-titles-button";
import { EmptyState } from "@/components/empty-state";
import { LIBRARY_PAGE_SIZE } from "@/components/library-list";
import { ListItemRow } from "@/components/list-item-row";
import { ListMenu } from "@/components/list-menu";
import { ShowMoreLink, limitFrom } from "@/components/show-more-link";
import { requireOnboardedSession } from "@/lib/auth";
import { getListDetail, type ListItemView } from "@/lib/queries";
import type { SearchParams } from "@/lib/search-params";

export const dynamic = "force-dynamic";

interface ListPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata({
  params,
}: Pick<ListPageProps, "params">) {
  const { id } = await params;
  // Gated before any read, like the movie page: metadata runs ahead of the
  // component and must not reveal a list's name without a session. A foreign
  // list reads as null, so it gets the same fallback as an unknown one.
  const { user } = await requireOnboardedSession();
  const list = await getListDetail(user.id, id);

  return { title: list ? `${list.name} · TV Tracker` : "List · TV Tracker" };
}

export default async function ListPage({
  params,
  searchParams,
}: ListPageProps) {
  const { id } = await params;
  const { user } = await requireOnboardedSession();
  const query = await searchParams;

  // List ids are opaque, so there is nothing to validate up front. A list that
  // belongs to someone else comes back null exactly like one that never
  // existed, which is what keeps the two indistinguishable.
  const list = await getListDetail(user.id, id);
  if (!list) notFound();

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
          <AddTitlesButton listId={list.id} listName={list.name} />
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
                param="listToWatch"
                searchParams={query}
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
                  param="listWatched"
                  searchParams={query}
                />
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** One paginated run of rows; "show more" is a URL, like the Library's. */
function ItemSection({
  listId,
  trackSeparately,
  items,
  param,
  searchParams,
}: {
  listId: string;
  trackSeparately: boolean;
  items: ListItemView[];
  param: string;
  searchParams: SearchParams;
}) {
  const limit = limitFrom(searchParams, param, LIBRARY_PAGE_SIZE);
  const shown = items.slice(0, limit);
  const remaining = items.length - shown.length;

  return (
    <>
      <ul className="flex flex-col gap-2">
        {shown.map((item) => (
          <ListItemRow
            key={item.itemId}
            listId={listId}
            trackSeparately={trackSeparately}
            item={item}
          />
        ))}
      </ul>

      {remaining > 0 ? (
        <ShowMoreLink
          param={param}
          current={searchParams}
          step={LIBRARY_PAGE_SIZE}
          shown={shown.length}
          remaining={remaining}
          label="Show"
        />
      ) : null}
    </>
  );
}
