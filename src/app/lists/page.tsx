import Image from "next/image";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { NewListButton } from "@/components/new-list-button";
import { ProfileButton } from "@/components/profile-button";
import { requireOnboardedSession } from "@/lib/auth";
import { posterUrl } from "@/lib/images";
import { getLists } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Lists · TV Tracker" };

/**
 * Your private lists. The gate lives here rather than in a component below,
 * because `tests/route-gates.test.ts` reads this file.
 */
export default async function ListsPage() {
  const { user } = await requireOnboardedSession();
  const lists = await getLists(user.id);

  return (
    <div>
      <div className="flex items-center justify-between gap-2.5">
        <h1 className="text-[30px] font-bold tracking-[-0.03em]">Lists</h1>
        <div className="flex items-center gap-2">
          <NewListButton />
          <ProfileButton nickname={user.nickname} />
        </div>
      </div>

      <div className="mt-[18px]">
        {lists.length === 0 ? (
          <EmptyState
            title="Start your first list"
            description="Keep shows and movies together for a mood, a friend, or a movie night."
            icon="list"
            action={<NewListButton />}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {lists.map((list) => (
              <li key={list.id}>
                <Link
                  href={`/lists/${list.id}`}
                  className="flex items-center gap-4 rounded-2xl bg-surface p-3 transition-colors hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <PosterFan paths={list.posterPaths} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] font-bold tracking-[-0.02em]">
                      {list.name}
                    </span>
                    <span className="mt-1 block text-[13px] text-muted">
                      {list.itemCount === 1
                        ? "1 title"
                        : `${list.itemCount} titles`}
                    </span>
                  </span>
                  {list.trackSeparately ? (
                    <span className="shrink-0 rounded-full bg-accent-tint px-2.5 py-1 text-[11px] font-semibold text-accent-deep">
                      Together
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Up to three posters fanned out, newest in front: a list's cover, so the
 * screen shows what is on each list instead of only its name. An empty list
 * gets the same footprint as a quiet placeholder, so names stay aligned.
 */
function PosterFan({ paths }: { paths: string[] }) {
  // Back to front: the newest poster is drawn last, on top.
  const layers = [...paths].reverse();
  // By distance from the front: upright, then leaning left, then right.
  const TILTS = ["rotate-0", "-rotate-6 -translate-x-3", "rotate-6 translate-x-3"];

  return (
    <span aria-hidden="true" className="relative flex h-[84px] w-[78px] shrink-0 items-center justify-center">
      {layers.length === 0 ? (
        <span className="h-[72px] w-12 rounded-lg bg-surface-raised" />
      ) : (
        layers.map((path, index) => {
          const url = posterUrl(path, "w185");
          const tilt = TILTS[layers.length - 1 - index];
          return url ? (
            <Image
              key={path}
              src={url}
              alt=""
              width={48}
              height={72}
              className={`absolute rounded-lg object-cover shadow-[0_6px_16px_rgba(0,0,0,.5)] ${tilt}`}
            />
          ) : null;
        })
      )}
    </span>
  );
}
