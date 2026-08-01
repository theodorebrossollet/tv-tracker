import { describe, expect, it } from "vitest";

import { nicknameKey, validateNickname } from "@/lib/nickname";

describe("validateNickname", () => {
  it("accepts letters, numbers and the allowed specials", () => {
    for (const value of ["Theo", "theo_92", "a-b.c", "x1!", "N#$&*", "abc"]) {
      expect(validateNickname(value), value).toMatchObject({ ok: true });
    }
  });

  it("keeps the casing the user chose, and folds only the key", () => {
    expect(validateNickname("ThEo")).toEqual({
      ok: true,
      nickname: "ThEo",
      key: "theo",
    });
  });

  it("trims surrounding whitespace rather than rejecting it", () => {
    // Almost always a copy-paste artefact; failing a first login over an
    // invisible character is a poor introduction to an unrecoverable account.
    expect(validateNickname("  theo\n")).toMatchObject({
      ok: true,
      nickname: "theo",
    });
  });

  it("enforces the length bounds after trimming", () => {
    expect(validateNickname("ab")).toMatchObject({ ok: false });
    expect(validateNickname("abcdefghijkl")).toMatchObject({ ok: true });
    expect(validateNickname("abcdefghijklm")).toMatchObject({ ok: false });
    // Trimmed first, so padding cannot buy length.
    expect(validateNickname("  a  ")).toMatchObject({ ok: false });
  });

  it("rejects characters that would need encoding in a URL path", () => {
    // A future profile page is expected at /u/<nickname>, so these stay out —
    // `%` in particular, which would need percent-encoding everywhere.
    for (const value of ["a/b", "a?b", "a b", "a%b", "a+b", "a=b", "a:b"]) {
      expect(validateNickname(value), value).toMatchObject({ ok: false });
    }
  });

  it("rejects non-ASCII", () => {
    for (const value of ["émoji", "théo", "日本語", "ab🎬"]) {
      expect(validateNickname(value), value).toMatchObject({ ok: false });
    }
  });

  it("requires at least one letter or number", () => {
    // Length and character set alone would admit all of these.
    for (const value of ["...", "---", "!!!", "@#$", "_._"]) {
      expect(validateNickname(value), value).toMatchObject({ ok: false });
    }

    expect(validateNickname("..a")).toMatchObject({ ok: true });
  });

  it("rejects an empty or whitespace-only value", () => {
    expect(validateNickname("")).toMatchObject({ ok: false });
    expect(validateNickname("   ")).toMatchObject({ ok: false });
  });
});

describe("nicknameKey", () => {
  it("folds case so two spellings collide", () => {
    expect(nicknameKey("Theo")).toBe(nicknameKey("theo"));
    expect(nicknameKey("THEO")).toBe("theo");
  });
});
