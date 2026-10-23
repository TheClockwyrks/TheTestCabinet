#!/usr/bin/env bash
# Prune the build output to what the next build of the same lock reads.
#
#   scripts/ci/prune-target.sh [<target directory>]
#
# The Rust job restores the cargo home and the build output from two cache
# tasks, and on a miss each task's post-job step archives its directory on the
# agent's disk before it uploads it. The build output after the gates holds far
# more than a later build reads, and its archive beside it fills the hosted
# agent's disk. So the job's last step, run whatever the gates answered, runs
# this before the post-job saves, which run in the reverse order of the
# restores and so after every step of the job.
#
# What goes is what no later build reads:
#
#   - the documentation, `doc` beside each profile;
#   - the gate artifacts under `gate-artifacts`, which the job has published;
#   - in each profile, the files cargo lifts to its top (the test and binary
#     executables and the workspace's own libraries), its examples and its
#     incremental state;
#   - the compiled artifacts of the workspace's own crates under `deps`, their
#     fingerprints under `.fingerprint` and their build scripts under `build`,
#     which every change to the workspace rebuilds anyway;
#   - any executable left under `deps`, which is a test or a binary.
#
# The compiled dependencies stay, which is what a later build of the same lock
# reuses. The workspace's crates are named by `cargo metadata`, read with
# `jq`. `tmp` is the suite's own scratch space, which a toolchain build keeps a
# cache of its own under, so it is left as it is.
#
# The free space of the root file system and the size of the directory are
# printed before and after, so a run's log shows the room the save has.
set -euo pipefail
shopt -s extglob nullglob

say() { printf 'prune-target: %s\n' "$*"; }
die() {
	printf 'prune-target: %s\n' "$1" >&2
	exit 1
}

target="${1:-target}"
target="${target%/}"

report() { # moment
	say "$1"
	df -h /
	du -sh "$target"
}

if [ ! -d "$target" ]; then
	say "no build output at $target, so nothing to prune"
	df -h /
	exit 0
fi

metadata="$(cargo metadata --no-deps --format-version 1 --offline)" ||
	die "cargo metadata could not name the workspace's crates"
packages=()
crates=()
mapfile -t packages < <(jq -r '.packages[].name' <<<"$metadata")
mapfile -t crates < <(jq -r '[.packages[].targets[].name | gsub("-"; "_")] | unique[]' <<<"$metadata")
[ "${#packages[@]}" -gt 0 ] || die "cargo metadata named no package in the workspace"

report "before"

rm -rf "$target/gate-artifacts"

# A profile is a directory holding a `.fingerprint`: `<target>/<profile>`, or
# `<target>/<triple>/<profile>` for a build naming its target.
profiles=()
while IFS= read -r -d '' fingerprint; do
	profiles+=("$(dirname "$fingerprint")")
done < <(find "$target" -mindepth 2 -maxdepth 3 -path "$target/tmp" -prune -o -type d -name .fingerprint -print0)

rm -rf "$target/doc"
for profile in "${profiles[@]}"; do
	rm -rf "$(dirname "$profile")/doc" "$profile/examples" "$profile/incremental"
	find "$profile" -mindepth 1 -maxdepth 1 -type f ! -name .cargo-lock -delete
	for package in "${packages[@]}"; do
		rm -rf "$profile/.fingerprint/$package"-+([0-9a-f]) "$profile/build/$package"-+([0-9a-f])
	done
	if [ -d "$profile/deps" ]; then
		for crate in "${crates[@]}"; do
			rm -f "$profile/deps/"?(lib)"$crate"-+([0-9a-f])?(.*)
		done
		find "$profile/deps" -maxdepth 1 -type f -perm -u+x ! -name '*.*' -delete
	fi
done

report "after"
