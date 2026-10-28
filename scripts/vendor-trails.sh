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
const seen=new Set(),stack=["@blazetrails/activerecord","@blazetrails/actionpack","@blazetrails/actionview","@blazetrails/trailties","@blazetrails/rack","@blazetrails/trails-tsc","@blazetrails/solid-queue"];
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

# Pack from a CLEAN build. `tsc --build` never deletes an output whose source
# is gone, so a checkout built at another commit first carries leftovers into
# `dist` — #39 found both kinds: `validations/_accessor.*` with no source at the
# pin, and `thor/*.test.*` from a build of a LATER commit. Each packed
# package's `dist` and its build info go, and the whole workspace is rebuilt
# (the root `build`, so the templates the packages ship are regenerated too).
# Slower than an incremental build, and the only way re-running this
# reproduces the committed tarballs whatever the checkout was built at last.
for p in "${PKGS[@]}"; do
  rm -rf "$TRAILS/packages/$p/dist" "$TRAILS/packages/$p"/*.tsbuildinfo
done
echo "  rebuilding trails from clean dist directories"
pnpm -C "$TRAILS" build >/dev/null

rm -f "$VENDOR"/*.tgz
mkdir -p "$VENDOR"
for p in "${PKGS[@]}"; do
  ( cd "$TRAILS/packages/$p" && pnpm pack --pack-destination "$VENDOR" >/dev/null )
  echo "  packed $p"
done
echo "$SHA" > "$VENDOR/TRAILS_PIN"

# Point every @blazetrails/* at its vendored tarball instead of the registry
# (these packages are unpublished — npm 404s).
#
# The overrides go in pnpm-workspace.yaml, and ONLY there. pnpm 11 ignores
# `pnpm.overrides` in package.json, which is where this script used to write
# them: the block it produced did nothing, the real one in pnpm-workspace.yaml
# was maintained by hand, and a bump that packed a NEW package — a dependency
# trails had grown since the last one — left it with no override at all, to
# 404 against the registry on the next cold install. So the block is
# regenerated here from what was actually packed, and package.json carries
# none.
node -e '
const fs=require("fs");
const [vendor,pkgPath,wsPath]=process.argv.slice(1);
const overrides={};
for(const f of fs.readdirSync(vendor).filter(f=>f.endsWith(".tgz")).sort()){
  const name="@blazetrails/"+f.replace(/^blazetrails-/,"").replace(/-\d+\.\d+\.\d+\.tgz$/,"");
  overrides[name]="file:./vendor/"+f;
}
const pkg=JSON.parse(fs.readFileSync(pkgPath,"utf8"));
if(pkg.pnpm){ delete pkg.pnpm.overrides; if(!Object.keys(pkg.pnpm).length) delete pkg.pnpm; }
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
// Replace the top-level `overrides:` block and nothing else: every other key
// in the file (allowBuilds, today) is kept exactly as written.
//
// PATTERN-BASED, deliberately, not through a YAML parser. None is a
// dependency, and adding one for a build script is a third-party dependency
// for a file this script writes in one shape; and a parser round-trip drops
// the comments the rest of the file carries. The cost is that a reformatted
// block (flow style, a nested comment) is not understood — the guard below
// refuses it by name rather than writing something wrong.
const kept=[]; let inBlock=false;
for(const line of fs.readFileSync(wsPath,"utf8").split("\n")){
  if(/^overrides:\s*$/.test(line)){ inBlock=true; continue; }
  if(inBlock && (/^\s+\S/.test(line) || line.trim()==="")) continue;
  inBlock=false; kept.push(line);
}
// The block is found by indentation, not parsed: it runs from `overrides:` to
// the next line at column 0. A comment at column 0 INSIDE it would end it
// early and strand the entries after it, so refuse rather than write a file
// with override lines belonging to nothing.
const stranded=kept.filter(line=>/^\s+["\x27]?@blazetrails\//.test(line));
if(stranded.length) throw new Error("pnpm-workspace.yaml: the overrides block is not one contiguous block ("+stranded.length+" entries outside it); fix the file by hand");
const head=kept.join("\n").replace(/\n+$/,"");
const block=["overrides:",...Object.entries(overrides).map(([n,v])=>"  "+JSON.stringify(n)+": "+JSON.stringify(v))].join("\n");
fs.writeFileSync(wsPath,(head?head+"\n\n":"")+block+"\n");
console.log("  overrides -> "+Object.keys(overrides).length+" packages (pnpm-workspace.yaml)");
' "$VENDOR" "$HERE/package.json" "$HERE/pnpm-workspace.yaml"

# Every @blazetrails/* package the application IMPORTS must be a declared
# dependency. The overrides above make a tarball resolvable; they do not make
# it a dependency, so a package the app starts importing (ruby-compat, at
# #30's bump) works by hoisting until something stops hoisting it. Checked
# here, by name, rather than discovered later as a typecheck failure.
node -e '
const fs=require("fs"),path=require("path");
const [here]=process.argv.slice(1);
const pkg=JSON.parse(fs.readFileSync(path.join(here,"package.json"),"utf8"));
const declared=new Set([...Object.keys(pkg.dependencies||{}),...Object.keys(pkg.devDependencies||{})]);
const used=new Map();
const walk=(dir)=>{
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const f=path.join(dir,e.name);
    if(e.isDirectory()){ if(e.name!=="node_modules") walk(f); continue; }
    if(!/\.(ts|tsx|mts|js|mjs|tse)$/.test(e.name)) continue;
    for(const m of fs.readFileSync(f,"utf8").matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["\x27](@blazetrails\/[a-z0-9-]+)/g)){
      if(!used.has(m[1])) used.set(m[1],path.relative(here,f));
    }
  }
};
for(const d of ["app","config","lib","scripts","test"]) if(fs.existsSync(path.join(here,d))) walk(path.join(here,d));
const missing=[...used].filter(([n])=>!declared.has(n));
if(missing.length){
  for(const [n,f] of missing) console.error("  "+n+" is imported ("+f+") but not a dependency in package.json");
  console.error("add each to package.json as \"file:vendor/blazetrails-<name>-<version>.tgz\" and re-run");
  process.exit(1);
}
console.log("  imports -> "+used.size+" @blazetrails packages, all declared");
' "$HERE"

echo "pinned trails @ $SHA"
echo "now run: pnpm install"
