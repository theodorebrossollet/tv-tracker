import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/auth", () => ({
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "s",
    user: { id: "u", nickname: "u", hasPassword: true },
  })),
}));

const { setViewMode } = await import("@/app/view-actions");
const { requireOnboardedSession } = await import("@/lib/auth");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setViewMode", () => {
  it("sets the cookie for a known mode, for a year, site-wide", async () => {
    expect(await setViewMode("posters")).toEqual({ ok: true });

    expect(set).toHaveBeenCalledTimes(1);
    const [name, value, options] = set.mock.calls[0];
    expect(name).toBe("view");
    expect(value).toBe("posters");
    expect(options).toMatchObject({
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("accepts rows too", async () => {
    expect(await setViewMode("rows")).toEqual({ ok: true });
    expect(set.mock.calls[0][1]).toBe("rows");
  });

  it("refuses anything else without touching the cookie", async () => {
    for (const bad of ["", "grid", "Posters", "posters; Path=/x", "__proto__"]) {
      const result = await setViewMode(bad);
      expect(result.ok).toBe(false);
    }
    expect(set).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("lets a rejected gate win before anything is written", async () => {
    vi.mocked(requireOnboardedSession).mockRejectedValueOnce(
      new Error("NEXT_REDIRECT"),
    );
    await expect(setViewMode("posters")).rejects.toThrow("NEXT_REDIRECT");
    expect(set).not.toHaveBeenCalled();
  });

  it("returns a failure rather than throwing when the cookie can't be set", async () => {
    set.mockImplementationOnce(() => {
      throw new Error("read-only");
    });
    expect((await setViewMode("posters")).ok).toBe(false);
  });
});
