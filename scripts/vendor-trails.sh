#!/usr/bin/env bash
# Re-vendor the pinned trails packages.
#
# The tasks CLI depends on trails, and agents dispatched BY this CLI are the
# ones editing trails. If we consumed trails from the live checkout, a broken
# trails main would wedge the CLI that dispatches the agent who'd fix it. So we
# consume immutable packed tarballs, and bumping the pin is a deliberate,
# revertible commit.
#
# Usage: scripts/vendor-trails.sh [trails-checkout] [git-ref]
#
# NOTE: the ref is used to RECORD the pin and to verify the checkout is on it —
# packing reads the WORKING TREE, not the ref. Passing an old ref while the
# checkout sits on main used to relabel the pin file without changing a single
# byte of vendored code, so the pin lied about what was installed. It now
# refuses rather than mislabel.
set -euo pipefail
TRAILS="${1:-$HOME/github/blazetrailsdev/trails}"
REF="${2:-HEAD}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$HERE/vendor"

# Transitive closure of @blazetrails/* deps from activerecord. Computed rather
# than hardcoded: activesupport pulls tse-compiler, which is easy to miss.
mapfile -t PKGS < <(cd "$TRAILS" && node -e '
const fs=require("fs"),path=require("path");
const byName={};
for(const d of fs.readdirSync("packages")){
  const pj=path.join("packages",d,"package.json");
  if(!fs.existsSync(pj))continue;
  const p=JSON.parse(fs.readFileSync(pj,"utf8"));
  byName[p.name]={dir:d,deps:Object.keys(p.dependencies||{})};
}
const seen=new Set(),stack=["@blazetrails/activerecord","@blazetrails/actionpack","@blazetrails/actionview","@blazetrails/trailties","@blazetrails/rack","@blazetrails/trails-tsc"];
while(stack.length){
  const n=stack.pop();
  if(seen.has(n)||!byName[n])continue;
  seen.add(n);
  for(const d of byName[n].deps) if(d.startsWith("@blazetrails/")) stack.push(d);
}
console.log([...seen].map(n=>byName[n].dir).sort().join("\n"));
')

SHA="$(git -C "$TRAILS" rev-parse "$REF")"
HEAD_SHA="$(git -C "$TRAILS" rev-parse HEAD)"
if [ "$SHA" != "$HEAD_SHA" ]; then
  echo "refusing to vendor: checkout is at ${HEAD_SHA:0:9} but you asked for ${SHA:0:9}." >&2
  echo "  Packing reads the working tree, so the pin would not match the code." >&2
  echo "  Check the ref out first:  git -C $TRAILS checkout $REF" >&2
  exit 1
fi
if [ -n "$(git -C "$TRAILS" status --porcelain)" ]; then
  echo "warning: trails checkout is dirty — vendored code will include uncommitted changes" >&2
fi
echo "vendoring ${#PKGS[@]} packages from trails @ ${SHA:0:9}"

rm -f "$VENDOR"/*.tgz
mkdir -p "$VENDOR"
for p in "${PKGS[@]}"; do
  ( cd "$TRAILS/packages/$p" && pnpm pack --pack-destination "$VENDOR" >/dev/null )
  echo "  packed $p"
done
echo "$SHA" > "$VENDOR/TRAILS_PIN"

# Rewrite pnpm.overrides so every @blazetrails/* resolves to a vendored tarball
# instead of the registry (these packages are unpublished — npm 404s).
node -e '
const fs=require("fs");
const vendor=process.argv[1], pkgPath=process.argv[2];
const overrides={};
for(const f of fs.readdirSync(vendor).filter(f=>f.endsWith(".tgz")).sort()){
  const name="@blazetrails/"+f.replace(/^blazetrails-/,"").replace(/-\d+\.\d+\.\d+\.tgz$/,"");
  overrides[name]="file:./vendor/"+f;
}
const pkg=JSON.parse(fs.readFileSync(pkgPath,"utf8"));
pkg.pnpm={...pkg.pnpm,overrides};
// Every @blazetrails/* the generator already listed becomes a vendored
// tarball spec. Keeping the generated dependency list authoritative means a
// generator change shows up here rather than being silently overridden.
for(const sec of ["dependencies","devDependencies"]){
  for(const n of Object.keys(pkg[sec]||{})){
    if(!n.startsWith("@blazetrails/")) continue;
    if(!overrides[n]) throw new Error("no vendored tarball for "+n);
    pkg[sec][n]=overrides[n].replace("file:./","file:");
  }
}
fs.writeFileSync(pkgPath,JSON.stringify(pkg,null,2)+"\n");
console.log("  overrides -> "+Object.keys(overrides).length+" packages");
' "$VENDOR" "$HERE/package.json"

echo "pinned trails @ $SHA"
echo "now run: pnpm install"
