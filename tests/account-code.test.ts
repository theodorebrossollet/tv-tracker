import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CODE_BYTES,
  CODE_LENGTH,
  isAccountCode,
  normalizeCode,
} from "@/lib/account-code";

describe("the shape of an account code", () => {
  it("accepts what the account scripts actually generate", () => {
    // Not a hand-written sample: this is the exact expression in
    // create-user.mjs, create-admin-user.mjs and reset-user-code.mjs. If the
    // scripts and this check ever disagree, every newly issued code stops
    // working — and the symptom is "the code I was just given is refused",
    // which points at the wrong thing entirely.
    for (let i = 0; i < 50; i++) {
      const real = randomBytes(CODE_BYTES).toString("hex");
      expect(isAccountCode(real), real).toBe(true);
    }
  });

  it("rejects anything that could not be one", () => {
    for (const bad of [
      "",
      "wrong",
      "correct-horse-battery-staple",
      "0".repeat(CODE_LENGTH - 1),
      "0".repeat(CODE_LENGTH + 1),
      // Hex is 0-9a-f; g is not.
      `g${"0".repeat(CODE_LENGTH - 1)}`,
      // Uppercase is handled by normalizeCode, not by the pattern — checked
      // separately below so the division of labour stays explicit.
      "A".repeat(CODE_LENGTH),
      "../../etc/passwd",
      `${"0".repeat(CODE_LENGTH)}\n${"0".repeat(CODE_LENGTH)}`,
    ]) {
      expect(isAccountCode(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("survives a code pasted with whitespace or capitals", () => {
    const real = randomBytes(CODE_BYTES).toString("hex");

    for (const messy of [
      ` ${real}`,
      `${real} `,
      `\n  ${real}\t\n`,
      real.toUpperCase(),
      `  ${real.toUpperCase()}\n`,
    ]) {
      expect(normalizeCode(messy)).toBe(real);
      expect(isAccountCode(normalizeCode(messy)), messy).toBe(true);
    }
  });

  it("keeps the length tied to the entropy it encodes", () => {
    // Hex is two characters a byte. Stated as an assertion because the two
    // constants are exported separately and a future change that raises one
    // without the other would be silent.
    expect(CODE_LENGTH).toBe(CODE_BYTES * 2);
    // 128 bits. Below this the "no rate limiting needed" argument in
    // docs/technical-design-v2.md stops holding.
    expect(CODE_BYTES * 8).toBeGreaterThanOrEqual(128);
  });
});
