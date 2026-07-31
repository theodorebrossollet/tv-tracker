// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
  clearAllData: vi.fn(async () => ({ ok: true })),
  updateCountry: vi.fn(async () => ({ ok: true })),
  updateNotificationPrefs: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { SettingsClient } = await import("@/app/settings/settings-client");

const regions = [
  { code: "FR", name: "France" },
  { code: "GB", name: "United Kingdom" },
];

afterEach(cleanup);

describe("settings reflect server-side changes", () => {
  // The bug class AGENTS.md says shipped twice here: a prop copied into
  // useState initialises once and then ignores every later value, so a
  // revalidation can never correct the display. Clearing all data resets both
  // of these server-side, which is exactly when it would be visible.
  it("shows the notification preference from the server, not the first render", () => {
    const { rerender } = render(
      <SettingsClient notifyEnabled={false} country={null} regions={regions} />,
    );

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    rerender(
      <SettingsClient notifyEnabled={true} country={null} regions={regions} />,
    );

    expect(checkbox.checked).toBe(true);
  });

  it("shows the country from the server, not the first render", () => {
    const { rerender } = render(
      <SettingsClient notifyEnabled={false} country={null} regions={regions} />,
    );

    const select = screen.getByLabelText("Country") as HTMLSelectElement;
    expect(select.value).toBe("");

    rerender(
      <SettingsClient notifyEnabled={false} country="FR" regions={regions} />,
    );

    expect(select.value).toBe("FR");
  });
});
