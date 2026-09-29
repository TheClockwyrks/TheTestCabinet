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
# gg.
#
# WHO RUNS THIS, AND HOW MANY gg BINARIES A COMMIT HAS. In CI, exactly one: the gates
# stage's `gg_<arch>` job runs scripts/ci/gg-dist.sh, which runs this, and the resulting
# `gg-<arch>` artifact is what the run images are self-checked against, what the driver and
# backend images bake (scripts/ci/gg-prebuilt.sh stages it as the `gg-build` named build
# context) and what is uploaded to the `gg-releases` container. The `gg-build` stage of
# deployments/images/services.Dockerfile also runs this script, and that is the OFFLINE path
# — `make -C deployments/local images` builds gg inside the image with no pipeline artifact
# to take it from — so the gg an image bakes always matches the image's platform either way.
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
# `--locked`: this script builds the gg that ships — as a release asset and as the
# binary baked into the driver image — so the dependency set must be exactly the
# committed Cargo.lock. A stale lock should fail the build loudly here rather than be
# silently updated into a shipped artifact nobody can reproduce.
cargo build -p test-cabinet-gg --release --locked --target "$target"

# Resolve the built binary. `CARGO_TARGET_DIR`, or the target directory the dev
# container's cargo config names, may move it off the default ./target path.
candidates=(
  "${CARGO_TARGET_DIR:-}/$target/release/gg"
  "$repo_root/target/$target/release/gg"
)
# `scripts/devcontainer-setup.sh` links /cargo-target/the-test-cabinet to the target
# directory cargo builds into in the dev container: the checkout's target/ on a Linux
# host, ~/.cache/cargo-target/the-test-cabinet on a virtiofs or FUSE host (macOS
# Podman, Docker Desktop). Discover it through the link if present.
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

# The identity of what this produced, on stderr so the stdout contract above is untouched.
# It is the cheapest thing in the file and the most useful: every consumer of this binary
# prints the same digest, so a gg that misbehaves can be matched to the build that linked it
# and to the other copies of it. Two links of the same commit that disagree on size are the
# whole diagnosis of a link defect, and the size was not in any log before this.
log "build-gg-static: $(ls -l "$bin")"
log "build-gg-static: $(sha256sum "$bin")"

log "build-gg-static: done -> $bin"
printf '%s\n' "$bin"
