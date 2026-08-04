// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sheet } from "@/components/sheet";

afterEach(cleanup);

function open(onClose = vi.fn()) {
  const result = render(
    <Sheet title="Track Severance as" onClose={onClose}>
      <button type="button">Paused</button>
    </Sheet>,
  );

  return { ...result, onClose };
}

describe("leaving a sheet without choosing anything", () => {
  // This is the bug the phone found. The dismissal check used to compare the
  // event target against the <dialog> itself, but the layout element inside it
  // fills the viewport — so a tap above the panel landed on *that*, never on
  // the dialog, and the handler never ran. With no Escape key on a phone, the
  // only way out of the sheet was to pick one of the options: a status change
  // nobody asked for, from a menu opened to look.

  it("closes on a tap outside the panel", () => {
    const { onClose, container } = open();

    // The element a tap above the panel actually lands on.
    const layout = container.querySelector("dialog > div")!;
    fireEvent.click(layout);

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on a tap on the dialog itself", () => {
    const { onClose, container } = open();

    fireEvent.click(container.querySelector("dialog")!);

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on the grab handle, which looks tappable because it is", () => {
    const { onClose } = open();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape without leaving the parent's state behind", () => {
    // `cancel` closes the dialog natively. Unless it is prevented and reported
    // upwards, the state that renders the sheet stays true and it can never be
    // opened again.
    const { onClose, container } = open();

    fireEvent(
      container.querySelector("dialog")!,
      new Event("cancel", { bubbles: false, cancelable: true }),
    );

    expect(onClose).toHaveBeenCalled();
  });
});

describe("what does not close it", () => {
  it("stays open when something inside the panel is tapped", () => {
    // The row handlers decide what happens next; dismissing here would race
    // them and drop the action.
    const { onClose } = open();

    fireEvent.click(screen.getByRole("button", { name: "Paused" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open when the title is tapped", () => {
    const { onClose } = open();

    fireEvent.click(screen.getByText("Track Severance as"));

    expect(onClose).not.toHaveBeenCalled();
  });
});
