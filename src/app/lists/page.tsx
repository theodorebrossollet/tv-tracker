import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { NewListButton } from "@/components/new-list-button";
import { requireOnboardedSession } from "@/lib/auth";
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
        <h1 className="text-[25px] font-semibold tracking-[-0.025em]">Lists</h1>
        <NewListButton />
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
                  className="flex min-h-[60px] items-center gap-3 rounded-[15px] border border-border p-[13px] transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium tracking-[-0.01em]">
                      {list.name}
                    </span>
                    <span className="mt-[3px] block text-xs text-muted">
                      {list.itemCount === 1
                        ? "1 title"
                        : `${list.itemCount} titles`}
                    </span>
                  </span>
                  {list.trackSeparately ? (
                    <span className="shrink-0 rounded-full border border-accent-border bg-accent-tint px-2.5 py-1 text-[11px] font-medium text-accent-deep">
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
