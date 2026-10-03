import { beforeAll, describe, expect, it } from "vitest";
import { getFs, getPath } from "@blazetrails/ruby-compat";
import { verifyRingoPin } from "../../scripts/ringo-pin.js";

/**
 * `vendor/ringo/` is the reference implementation both ringo gates diff
 * against, so it has to be tamper-evident: a hand-edit there turns ringo's
 * code into a copy of ours and leaves the gates green over nothing.
 */
describe("verifyRingoPin", () => {
  it("returns the pinned commit for the snapshot this repo ships", async () => {
    expect(await verifyRingoPin()).toMatch(/^[0-9a-f]{40}$/);
  });

  it("refuses a snapshot whose file no longer matches SHA256", async () => {
    const [fs, path] = await Promise.all([getFs(), getPath()]);
    const dir = path.join("tmp", "ringo-pin-test");
    await fs.mkdir!(dir, { recursive: true });
    await fs.writeFile!(path.join(dir, "PIN"), "0".repeat(40) + "\n");
    await fs.writeFile!(path.join(dir, "SHA256"), `${"a".repeat(64)}  edited.js\n`);
    await fs.writeFile!(path.join(dir, "edited.js"), "// a hand-edit\n");

    await expect(verifyRingoPin(dir)).rejects.toThrow("does not match");
  });
});
