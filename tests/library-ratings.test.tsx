// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
  addToWatchlist: vi.fn(),
  removeShow: vi.fn(),
  pauseShow: vi.fn(),
  resumeShow: vi.fn(),
  stopShow: vi.fn(),
  setMovieStatus: vi.fn(),
  removeMovie: vi.fn(),
}));
vi.mock("@/app/list-actions", () => ({
  removeFromList: vi.fn(),
  setListItemWatched: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { LibraryList } = await import("@/components/library-list");
const { MovieList } = await import("@/components/movie-list");
const { ListItemRow } = await import("@/components/list-item-row");
import type {
  ListItemView,
  MovieSummary,
  TrackedShowSummary,
} from "@/lib/queries";

afterEach(cleanup);

function show(over: Partial<TrackedShowSummary> = {}): TrackedShowSummary {
  return {
    showId: "1",
    name: "Severance",
    posterPath: null,
    status: "watching",
    airedCount: 10,
    watchedCount: 4,
    fullyWatched: false,
    showStatus: "Returning Series",
    lastWatchedAt: null,
    addedAt: new Date("2026-01-01T00:00:00Z"),
    ratingAverage: null,
    nextUnwatched: null,
    ...over,
  };
}

function movie(over: Partial<MovieSummary> = {}): MovieSummary {
  return {
    movieId: "1",
    title: "Heat",
    posterPath: null,
    releaseDate: new Date("1995-12-15T00:00:00Z"),
    runtime: 170,
    status: "watchlist",
    watchedAt: null,
    addedAt: new Date("2026-01-01T00:00:00Z"),
    rating: null,
    ...over,
  };
}

function item(over: Partial<ListItemView> = {}): ListItemView {
  return {
    itemId: "i1",
    kind: "movie",
    titleId: "603",
    title: "The Matrix",
    posterPath: null,
    year: "1999",
    status: null,
    finished: false,
    tickedAt: null,
    watched: false,
    addedAt: new Date("2026-01-01T00:00:00Z"),
    rating: null,
    ...over,
  };
}

function renderShows(shows: TrackedShowSummary[]) {
  return render(
    <LibraryList shows={shows} param="w" searchParams={{}} limit={10} />,
  );
}

function renderMovies(movies: MovieSummary[]) {
  return render(
    <MovieList
      movies={movies}
      detail="released"
      param="w"
      searchParams={{}}
      limit={10}
    />,
  );
}

const noJunk = (container: HTMLElement) => {
  expect(container.textContent).not.toMatch(/NaN|undefined|null/);
};

describe("Library show rows", () => {
  it("shows the average, one decimal, after the detail text", () => {
    const { container } = renderShows([show({ ratingAverage: 7.4 })]);
    expect(screen.getByText("7.4")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Average rating 7.4 out of 10" }),
    ).toBeTruthy();
    expect(container.textContent).toContain("10 episodes available");
    noJunk(container);
  });

  it("shows a whole average with its decimal", () => {
    renderShows([show({ ratingAverage: 8 })]);
    expect(screen.getByText("8.0")).toBeTruthy();
  });

  it("shows nothing for an unrated show", () => {
    const { container } = renderShows([show()]);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.textContent).not.toContain("★");
  });
});

describe("Library movie rows", () => {
  it("shows the whole rating, and nothing for an unrated movie", () => {
    const { container } = renderMovies([
      movie({ movieId: "1", title: "Heat", rating: 8 }),
      movie({ movieId: "2", title: "Ronin", rating: null }),
    ]);
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Rated 8 out of 10" })).toBeTruthy();
    expect(container.textContent).toContain("1995 · 170 min");
    noJunk(container);
  });

  it("renders a rating cleanly when there is no year or runtime", () => {
    const { container } = renderMovies([
      movie({ releaseDate: null, runtime: null, rating: 6 }),
    ]);
    const rating = screen.getByRole("img", { name: "Rated 6 out of 10" });
    expect(rating.parentElement?.textContent?.trim()).toBe("★ 6");
    expect(container.textContent).not.toContain("·");
    noJunk(container);
  });

  it("renders no empty detail when nothing is known", () => {
    renderMovies([movie({ releaseDate: null, runtime: null })]);
    expect(document.querySelectorAll("span.text-xs")).toHaveLength(0);
  });
});

describe("list rows", () => {
  it("shows a movie's whole rating and a show's average", () => {
    const { container } = render(
      <ul>
        <ListItemRow
          listId="L"
          trackSeparately={false}
          item={item({ itemId: "a", kind: "movie", titleId: "5", rating: 9 })}
        />
        <ListItemRow
          listId="L"
          trackSeparately={false}
          item={item({
            itemId: "b",
            kind: "show",
            titleId: "5",
            title: "Dark",
            rating: 7.5,
          })}
        />
      </ul>,
    );
    expect(screen.getByRole("img", { name: "Rated 9 out of 10" })).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Average rating 7.5 out of 10" }),
    ).toBeTruthy();
    noJunk(container);
  });

  it("shows a show's whole average with a decimal", () => {
    render(
      <ListItemRow
        listId="L"
        trackSeparately={false}
        item={item({ kind: "show", rating: 8 })}
      />,
    );
    expect(screen.getByText("8.0")).toBeTruthy();
  });

  it("shows nothing for an unrated title", () => {
    render(<ListItemRow listId="L" trackSeparately={false} item={item()} />);
    expect(document.body.textContent).not.toContain("★");
  });

  it("renders cleanly with a rating and no year", () => {
    const { container } = render(
      <ListItemRow
        listId="L"
        trackSeparately
        item={item({ year: null, rating: 4 })}
      />,
    );
    expect(screen.getByRole("img", { name: "Rated 4 out of 10" })).toBeTruthy();
    expect(container.textContent).not.toContain("·");
    noJunk(container);
  });
});
