// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/action-result";
import type { TitleListMembership } from "@/lib/queries";

const addToList =
  vi.fn<(l: string, k: string, t: string) => Promise<ActionResult>>();
const removeFromList = vi.fn<(l: string, i: string) => Promise<ActionResult>>();
const createList =
  vi.fn<(n: string, s: boolean) => Promise<ActionResult & { id?: string }>>();

vi.mock("@/app/list-actions", () => ({
  addToList: (l: string, k: string, t: string) => addToList(l, k, t),
  removeFromList: (l: string, i: string) => removeFromList(l, i),
  createList: (n: string, s: boolean) => createList(n, s),
  updateList: vi.fn(),
}));

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
}

const { AddToListButton } = await import("@/components/add-to-list-button");

const LISTS: TitleListMembership[] = [
  { listId: "l1", name: "Weekend", onList: true, itemId: "i1" },
  { listId: "l2", name: "Date night", onList: false, itemId: null },
];

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(cleanup);

function open(
  lists = LISTS,
  kind: "movie" | "show" = "movie",
  titleId = "603",
) {
  render(<AddToListButton kind={kind} titleId={titleId} lists={lists} />);
  fireEvent.click(screen.getByRole("button", { name: "Add to list" }));
}

describe("AddToListButton", () => {
  it("lists the account's lists with their on/off state", () => {
    open();
    const weekend = screen.getByRole("checkbox", { name: /weekend/i });
    const date = screen.getByRole("checkbox", { name: /date night/i });
    expect((weekend as HTMLInputElement).checked).toBe(true);
    expect((date as HTMLInputElement).checked).toBe(false);
  });

  it("adds with the page's own kind and ids", async () => {
    addToList.mockResolvedValue({ ok: true });
    open(LISTS, "show", "1399");
    fireEvent.click(screen.getByRole("checkbox", { name: /date night/i }));
    expect(addToList).toHaveBeenCalledWith("l2", "show", "1399");
    await waitFor(() => expect(addToList).toHaveBeenCalledTimes(1));
  });

  it("removes using the item id", async () => {
    removeFromList.mockResolvedValue({ ok: true });
    open();
    fireEvent.click(screen.getByRole("checkbox", { name: /weekend/i }));
    expect(removeFromList).toHaveBeenCalledWith("l1", "i1");
    expect(addToList).not.toHaveBeenCalled();
    await waitFor(() => expect(removeFromList).toHaveBeenCalledTimes(1));
  });

  it("flips optimistically and disables the row while pending", async () => {
    let resolve!: (r: ActionResult) => void;
    addToList.mockReturnValue(new Promise((r) => (resolve = r)));
    open();
    const date = screen.getByRole("checkbox", {
      name: /date night/i,
    }) as HTMLInputElement;
    fireEvent.click(date);
    await waitFor(() => expect(date.checked).toBe(true));
    expect(date.disabled).toBe(true);
    resolve({ ok: true });
    await waitFor(() => expect(date.disabled).toBe(false));
  });

  it("keeps a failure on screen after settling and reverts the row", async () => {
    addToList.mockResolvedValue({ ok: false, error: "List is full." });
    open();
    const date = screen.getByRole("checkbox", {
      name: /date night/i,
    }) as HTMLInputElement;
    fireEvent.click(date);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("List is full.");
    await waitFor(() => expect(date.checked).toBe(false));
    expect(date.disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("List is full.");
  });

  it("does not throw when an on-list row has no item id", () => {
    open([{ listId: "l1", name: "Weekend", onList: true, itemId: null }]);
    fireEvent.click(screen.getByRole("checkbox", { name: /weekend/i }));
    expect(removeFromList).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("creates a list from New list, then adds the title to it", async () => {
    createList.mockResolvedValue({ ok: true, id: "new1" });
    addToList.mockResolvedValue({ ok: true });
    open();
    fireEvent.click(screen.getByRole("button", { name: "New list" }));
    fireEvent.change(screen.getByLabelText("List name"), {
      target: { value: "Horror" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create list" }));

    await waitFor(() =>
      expect(addToList).toHaveBeenCalledWith("new1", "movie", "603"),
    );
    expect(createList).toHaveBeenCalledWith("Horror", false);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/added/i),
    );
  });

  it("says the list exists when the add after create fails", async () => {
    createList.mockResolvedValue({ ok: true, id: "new1" });
    addToList.mockResolvedValue({ ok: false, error: "Nope." });
    open();
    fireEvent.click(screen.getByRole("button", { name: "New list" }));
    fireEvent.change(screen.getByLabelText("List name"), {
      target: { value: "Horror" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create list" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/list was created/i);
    expect(alert.textContent).toContain("Nope.");
  });

  it("with no lists shows only the New list row and a hint", () => {
    open([]);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "New list" })).toBeTruthy();
    expect(screen.getByText(/lists let you/i)).toBeTruthy();
  });
});
