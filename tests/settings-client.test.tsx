// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
  clearAllData: vi.fn(async () => ({ ok: true })),
  updateCountry: vi.fn(async () => ({ ok: true })),
  updateNotificationPrefs: vi.fn(async () => ({ ok: true })),
  updateProviders: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { SettingsClient } = await import("@/app/settings/settings-client");

const regions = [
  { code: "FR", name: "France" },
  { code: "GB", name: "United Kingdom" },
];

const providerOptions = [
  { id: 8, name: "Netflix", logoPath: null },
  { id: 350, name: "Apple TV+", logoPath: null },
];

// Nothing left to reveal — the "show more" control is exercised in its own
// tests; here it just needs to stay out of the way.
const providerMore = {
  param: "providers",
  current: {},
  step: 24,
  shown: providerOptions.length,
  remaining: 0,
};

afterEach(cleanup);

describe("settings reflect server-side changes", () => {
  // The bug class AGENTS.md says shipped twice here: a prop copied into
  // useState initialises once and then ignores every later value, so a
  // revalidation can never correct the display. Clearing all data resets both
  // of these server-side, which is exactly when it would be visible.
  it("shows the notification preference from the server, not the first render", () => {
    const { rerender } = render(
      <SettingsClient
        notifyEnabled={false}
        country={null}
        regions={regions}
        providerOptions={providerOptions}
        providerIds={[]}
        browsingProviders={false}
        providerMore={providerMore}
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: /Air-date alerts/,
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    rerender(
      <SettingsClient
        notifyEnabled={true}
        country={null}
        regions={regions}
        providerOptions={providerOptions}
        providerIds={[]}
        browsingProviders={false}
        providerMore={providerMore}
      />,
    );

    expect(checkbox.checked).toBe(true);
  });

  it("shows the country from the server, not the first render", () => {
    const { rerender } = render(
      <SettingsClient
        notifyEnabled={false}
        country={null}
        regions={regions}
        providerOptions={providerOptions}
        providerIds={[]}
        browsingProviders={false}
        providerMore={providerMore}
      />,
    );

    const select = screen.getByLabelText("Country") as HTMLSelectElement;
    expect(select.value).toBe("");

    rerender(
      <SettingsClient
        notifyEnabled={false}
        country="FR"
        regions={regions}
        providerOptions={providerOptions}
        providerIds={[]}
        browsingProviders={false}
        providerMore={providerMore}
      />,
    );

    expect(select.value).toBe("FR");
  });

  it("shows the picked services from the server, not the first render", () => {
    const { rerender } = render(
      <SettingsClient
        notifyEnabled={false}
        country={null}
        regions={regions}
        providerOptions={providerOptions}
        providerIds={[]}
        browsingProviders={false}
        providerMore={providerMore}
      />,
    );

    const netflix = screen.getByRole("checkbox", {
      name: "Netflix",
    }) as HTMLInputElement;
    expect(netflix.checked).toBe(false);

    rerender(
      <SettingsClient
        notifyEnabled={false}
        country={null}
        regions={regions}
        providerOptions={providerOptions}
        providerIds={[8]}
        browsingProviders={false}
        providerMore={providerMore}
      />,
    );

    expect(netflix.checked).toBe(true);
  });
});

describe("browsing the service catalogue", () => {
  // TMDB lists several hundred services per region, so the group shows only
  // what you subscribe to until you ask for the rest. The reveal is a URL, and
  // this row is both directions of it — stuck in either state, the group is
  // permanently unbrowsable or permanently 24 rows long.
  function renderWith(browsing: boolean) {
    return render(
      <SettingsClient
        notifyEnabled={false}
        country={null}
        regions={regions}
        providerOptions={providerOptions}
        providerIds={[]}
        browsingProviders={browsing}
        providerMore={providerMore}
      />,
    );
  }

  it("offers the catalogue when collapsed", () => {
    renderWith(false);

    const link = screen.getByRole("link", { name: "Choose services" });
    expect(link.getAttribute("href")).toBe("?providers=24");
  });

  it("offers the way back out while browsing", () => {
    renderWith(true);

    const link = screen.getByRole("link", { name: "Done choosing" });
    expect(link.getAttribute("href")).toBe("/settings");
  });
});
