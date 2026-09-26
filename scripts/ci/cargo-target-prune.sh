#!/usr/bin/env bash
# Removes the executables cargo linked from every profile directory under
# `target/`, so the cargo target cache a job saves holds the compiled libraries
# and nothing that is cheap to link again.
#
#   scripts/ci/cargo-target-prune.sh
#
# A workspace build with `--all-targets` links one test binary per crate, and
# each carries its own copy of every dependency it links: together they are
# most of `target/` and more than the agent's disk can hold twice, which the
# cache save needs (the archive is written beside the tree). The libraries
# (`.rlib`, `.rmeta`, proc-macro `.so`/`.dll`), the `.d` dep-info and the
# build-script outputs under `build/` stay, so the next run compiles nothing it
# has cached and relinks the binaries. On Windows the binaries are `.exe` and
# their debug information `.pdb`.
#
# Run it after the last step that needs a linked binary: the binary jobs
# publish `tcab` before it runs.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# The literal `target/` the Cache task saves, whatever CARGO_TARGET_DIR says.
readonly TARGET="target"

if [[ ! -d "$TARGET" ]]; then
	log "no ${TARGET}/ to prune"
	exit 0
fi

log "target before prune"
du -sh "$TARGET"

# The linked artifacts of a profile sit in three places: `deps/` (every binary
# cargo linked, test binaries included), the profile root (the bins, hard-linked
# from `deps/`) and `examples/`. Any regular file there whose name carries no
# extension is a Linux binary; `.exe` and `.pdb` are their Windows counterparts.
for profile in "$TARGET"/*/; do
	[[ -d "${profile}deps" ]] || continue
	for dir in "${profile}deps" "$profile" "${profile}examples"; do
		[[ -d "$dir" ]] || continue
		find "$dir" -maxdepth 1 -type f \
			\( ! -name '*.*' -o -name '*.exe' -o -name '*.pdb' \) \
			-delete
	done
done

log "target after prune"
du -sh "$TARGET"
