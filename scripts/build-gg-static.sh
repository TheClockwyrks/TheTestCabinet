#!/usr/bin/env bash
# Build `gg` — The Test Cabinet's in-container coding harness — as a fully STATIC
# musl binary for the host architecture.
#
# Why static musl (not a normal glibc build): gg runs *inside* the run container,
# and a run's image varies by test type — most are glibc Debian bookworm, but the
# blender image is Ubuntu. A statically linked musl binary has no libc/loader
# dependency, so ONE gg build runs unmodified across every run-container image. It
# is also what makes gg installable by simply copying the bytes in (the LOCAL
# install path in `core::gg_exec`) or downloading a single release asset.
#
# This is a NATIVE build (target arch == host arch); it does not cross-compile. In
# the aarch64 devcontainer it yields an aarch64-musl gg; on x86_64 CI an x86_64-musl
# gg. The driver image's build stage (deployments/images/driver.Dockerfile) runs
# this same script, so the gg it bakes in always matches the image's platform.
#
# Usage:
#   scripts/build-gg-static.sh [OUT_PATH]
#
# With OUT_PATH the built binary is copied there (parent dirs created, mode 0755).
# The final binary path is printed as the last line of stdout; progress goes to
# stderr, so `bin=$(scripts/build-gg-static.sh)` captures just the path.
set -euo pipefail

log() { printf '%s\n' "$*" >&2; }

host_arch="$(uname -m)"
case "$host_arch" in
  x86_64 | amd64) target="x86_64-unknown-linux-musl" ;;
  aarch64 | arm64) target="aarch64-unknown-linux-musl" ;;
  *)
    log "build-gg-static: unsupported host architecture '$host_arch' (expected x86_64 or aarch64)"
    exit 1
    ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# The musl target and a musl C toolchain (musl-gcc) are prerequisites: gg links
# `ring` (via rustls/reqwest) and `wasmtime`, both of which compile a little C that
# must be built for the musl target.
if ! rustup target list --installed 2>/dev/null | grep -qx "$target"; then
  log "build-gg-static: adding rustup target $target"
  rustup target add "$target"
fi
if ! command -v musl-gcc >/dev/null 2>&1; then
  log "build-gg-static: musl-gcc not found on PATH — install a musl C toolchain (Debian/Ubuntu: 'apt-get install musl-tools')"
  exit 1
fi

# Point cargo's linker and the `cc` crate (ring/wasmtime C) at musl-gcc for this
# target. Both the underscored env-var forms are what cargo and the `cc` crate read.
tgt_us="${target//-/_}"                                 # e.g. aarch64_unknown_linux_musl
tgt_up="$(printf '%s' "$tgt_us" | tr '[:lower:]' '[:upper:]')"
export "CARGO_TARGET_${tgt_up}_LINKER=musl-gcc"
export "CC_${tgt_us}=musl-gcc"
# musl targets already link the CRT statically; make it explicit so the result is a
# fully static binary regardless of toolchain defaults.
export RUSTFLAGS="${RUSTFLAGS:-} -C target-feature=+crt-static"

log "build-gg-static: building gg for $target (release, static)"
cargo build -p test-cabinet-gg --release --target "$target"

# Resolve the built binary. `CARGO_TARGET_DIR` (or this repo's relocated dev-container
# target dir) may move it off the default ./target path.
candidates=(
  "${CARGO_TARGET_DIR:-}/$target/release/gg"
  "$repo_root/target/$target/release/gg"
)
# The dev container relocates the workspace target dir; discover it if present.
while IFS= read -r p; do candidates+=("$p"); done < <(ls -1 /cargo-target/*/"$target"/release/gg 2>/dev/null || true)

bin=""
for c in "${candidates[@]}"; do
  if [ -n "$c" ] && [ -f "$c" ]; then bin="$c"; break; fi
done
if [ -z "$bin" ]; then
  log "build-gg-static: could not locate the built gg binary for $target"
  exit 1
fi

if [ "${1:-}" != "" ]; then
  mkdir -p "$(dirname "$1")"
  cp "$bin" "$1"
  chmod 0755 "$1"
  bin="$1"
fi

log "build-gg-static: done -> $bin"
printf '%s\n' "$bin"
