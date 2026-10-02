#!/usr/bin/env bash
#
# Compile the vendored ringo core (vendor/ringo/go) to a WASI module.
#
#     ./scripts/build-ringo-wasm.sh <out.wasm>
#     ./scripts/build-ringo-wasm.sh --check
#
# scripts/vendor-ringo.sh calls the first form to produce the committed
# vendor/ringo/core.wasm. `--check` rebuilds into tmp/ and compares: SHA256
# proves nobody edited the binary after it was vendored, but only a rebuild
# proves the binary IS the source beside it — and the binary, not the source,
# is what the application runs.
#
# The flags are what make that comparison meaningful. -trimpath keeps the
# checkout's absolute path out of the binary, -buildid= drops the per-build
# id, and -s -w strip the symbol and debug tables, so the same source and the
# same Go release (vendor/ringo/go/.go-version) give the same bytes on any
# machine.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
src=$root/vendor/ringo/go

build() {
  (cd "$src" && GOOS=wasip1 GOARCH=wasm GOFLAGS= CGO_ENABLED=0 \
    go build -trimpath -ldflags='-s -w -buildid=' -o "$1" ./cmd/core)
}

case ${1:-} in
  "")
    echo "usage: $0 <out.wasm> | --check" >&2
    exit 2
    ;;
  --check)
    want=$(cat "$src/.go-version")
    have=$(go env GOVERSION | sed 's/^go//')
    if [ "$have" != "$want" ]; then
      echo "error: core.wasm was built with go $want and this is go $have — a different release emits different bytes, so there is nothing to compare." >&2
      exit 1
    fi
    mkdir -p "$root/tmp"
    build "$root/tmp/core.wasm"
    if cmp -s "$root/tmp/core.wasm" "$root/vendor/ringo/core.wasm"; then
      echo "vendor/ringo/core.wasm is vendor/ringo/go, built with go $want."
    else
      echo "error: vendor/ringo/core.wasm is NOT what vendor/ringo/go builds to. Regenerate the snapshot with scripts/vendor-ringo.sh." >&2
      exit 1
    fi
    ;;
  *)
    case $1 in /*) out=$1 ;; *) out=$PWD/$1 ;; esac
    build "$out"
    ;;
esac
