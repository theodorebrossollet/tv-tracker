// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/list-actions", () => ({
  createList: vi.fn(),
  updateList: vi.fn(),
}));

const { createList, updateList } = await import("@/app/list-actions");
const { ListFormSheet } = await import("@/components/list-form-sheet");

const create = vi.mocked(createList);
const update = vi.mocked(updateList);

beforeEach(() => {
  create.mockReset();
  update.mockReset();
});
afterEach(cleanup);

function type(value: string) {
  fireEvent.change(screen.getByLabelText("List name"), { target: { value } });
}

describe("creating", () => {
  it("titles the sheet and starts with the switch off", () => {
    render(<ListFormSheet mode="create" onClose={vi.fn()} />);

    expect(
      screen.getByRole("dialog", { hidden: true, name: "New list" }),
    ).toBeTruthy();
    const box = screen.getByLabelText(
      "Track what you've watched separately in this list",
    ) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(
      (screen.getByLabelText("List name") as HTMLInputElement).maxLength,
    ).toBe(60);
  });

  it("shows an error for an empty name and does not call the action", () => {
    render(<ListFormSheet mode="create" onClose={vi.fn()} />);

    type("   ");
    fireEvent.click(screen.getByRole("button", { name: "Create list" }));

    expect(screen.getByRole("alert").textContent).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it("passes the name and the switch through, then reports the id and closes", async () => {
    create.mockResolvedValue({ ok: true, id: "l1" });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<ListFormSheet mode="create" onClose={onClose} onSaved={onSaved} />);

    type("Movie night");
    fireEvent.click(
      screen.getByLabelText(
        "Track what you've watched separately in this list",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create list" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("l1"));
    expect(create).toHaveBeenCalledWith("Movie night", true);
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the server's error on screen after the action settles", async () => {
    create.mockResolvedValue({
      ok: false,
      error: "You already have that list.",
    });
    const onClose = vi.fn();
    render(<ListFormSheet mode="create" onClose={onClose} />);

    type("Dupes");
    fireEvent.click(screen.getByRole("button", { name: "Create list" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "You already have that list.",
      ),
    );
    // Still there once the transition has ended.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("alert").textContent).toBe(
      "You already have that list.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("editing", () => {
  it("prefills and calls updateList", async () => {
    update.mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    render(
      <ListFormSheet
        mode="edit"
        initial={{ id: "l9", name: "Sci-fi", trackSeparately: true }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    expect((screen.getByLabelText("List name") as HTMLInputElement).value).toBe(
      "Sci-fi",
    );
    expect(
      (
        screen.getByLabelText(
          "Track what you've watched separately in this list",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);

    type("Space");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("l9"));
    expect(update).toHaveBeenCalledWith("l9", {
      name: "Space",
      trackSeparately: true,
    });
    expect(create).not.toHaveBeenCalled();
  });
});
