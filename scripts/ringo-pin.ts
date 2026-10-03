/**
 * The vendored ringo snapshot, checked before anything runs against it.
 *
 * `vendor/ringo/` is the reference implementation both gates diff against, so
 * a hand-edit there — a well-meant "fix" to make a gate pass — would quietly
 * turn ringo's code into a copy of ours and leave the gates green over
 * nothing. `SHA256` records what scripts/vendor-ringo.sh took from the commit
 * in `PIN`; this re-derives it. Regenerate the snapshot rather than editing it.
 */
import { Dir, getCryptoAsync, getFs, getPath } from "@blazetrails/ruby-compat";

/**
 * The pinned commit, once every vendored file has been proven to match.
 * Throws when one no longer hashes to what `SHA256` records. `dir` exists so
 * the test can point it at a snapshot it controls.
 */
export async function verifyRingoPin(dir?: string): Promise<string> {
  const [fs, path, crypto] = await Promise.all([getFs(), getPath(), getCryptoAsync()]);
  dir ??= path.join(Dir.pwd(), "vendor", "ringo");
  const manifest = await fs.readFile!(path.join(dir, "SHA256"), "utf8");

  for (const line of manifest.split("\n").filter((l) => l.trim() !== "")) {
    // `sha256sum` output: "<hex>  <path>", two spaces.
    const [want, file] = line.split(/\s+/, 2) as [string, string];
    const got = crypto
      .createHash("sha256")
      // Bytes, not a utf8 decode: core.wasm is in the manifest, and decoding a
      // binary replaces what it cannot read before the hash ever sees it.
      .update(await fs.readFile!(path.join(dir, file)))
      .digest("hex");
    if (got !== want) {
      throw new Error(
        `vendor/ringo/${file} does not match vendor/ringo/SHA256 — it was edited by hand. ` +
          "Regenerate the snapshot with scripts/vendor-ringo.sh instead.",
      );
    }
  }
  return (await fs.readFile!(path.join(dir, "PIN"), "utf8")).trim();
}
