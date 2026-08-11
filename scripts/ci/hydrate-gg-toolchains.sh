#!/usr/bin/env bash
# Seed this machine's `$HOME` with gg's eleven program-language toolchains from the published
# CI image, so the pinned installers that run next find their work already done.
#
# WHAT PROBLEM THIS SOLVES, AND WHICH HALF OF IT IS THE IMPORTANT HALF. Every job that compiles
# `test-cabinet-gg` needs ~1.9 GB of compilers on disk first — `crates/gg/build.rs` reflects a
# signature catalogue out of each of the eleven arms' SDKs on every build, so this is a BUILD
# requirement and not a test one. `scripts/ci/install-gg-toolchains.sh` provides them, and it works:
# it is the one pinned list, it is idempotent, and it is what the devcontainer, both CI systems, the
# release workflow and the driver image all run. What it costs on a cold agent is ten-ish minutes
# and, more to the point, five separate upstreams — swift.org, dot.net, Maven Central, GitHub
# releases and npm — every one of which is a way for a run to go red for a reason that has nothing
# to do with the change under test. Replacing five CDNs with one registry pull on the CI provider's
# own network is worth more than the minutes are.
#
# WHAT THIS SCRIPT IS NOT: a replacement for that installer. It runs BEFORE it, never instead of it.
# The image supplies the bytes and the pinned list then verifies them — an image built before a pin
# moved is repaired, arm by arm, by the installer that owns the pin. That ordering is the whole
# safety argument, and it is why this script is allowed to be best-effort in a way an installer
# never could be.
#
# BEST-EFFORT, DELIBERATELY, AND IT MUST STAY THAT WAY. Every failure path here — no `docker`, no
# image reference, a registry 404 or 401, a broken pull — exits 0 with an explanation. Three
# situations make that a requirement rather than a kindness:
#
#   1. THE FIRST RUN. The image is published by `.github/workflows/build-gg-ci-image.yml`, which
#      only runs on master/staging. On the commit that introduces all of this there is no image to
#      pull, and a hard failure would mean the change could never be merged to produce one.
#   2. A FORK. The reference is built from the repository owner, so a fork resolves its own
#      namespace, where nothing has ever been published — and a fork's contributor is exactly the
#      person who should not have to understand this file.
#   3. A PIN BUMP. Between the commit that moves a pin and the image rebuild that follows it, the
#      published image is stale for one arm. That is handled by the installer, above, and not by
#      this script — but it is also why "the image is wrong" must never be fatal here.
#
# In all three cases the job simply does what it did before this script existed: installs everything
# from upstream. Slower, and green.
#
# WHY `docker cp` OUT OF A CONTAINER RATHER THAN A `container:` JOB. A GitHub Actions container job
# remaps `HOME` to `/github/home`, a bind mount of the runner's own scratch directory, which shadows
# the one directory this image exists to carry. And `$HOME` is not negotiable: three of the eleven
# arms cannot be installed anywhere else at all (uv overwrites `UV_INSTALL_DIR`, the YARD gem goes
# to `Gem.user_dir`, and the `wasm32-unknown-unknown` standard library is a rustup component), which
# is the same fact that decided where `containers/gg-ci/Dockerfile` installs them. Copying out of a
# created-but-never-started container is the operation that puts the tree where the reflectors look.
#
# WHAT IS DELIBERATELY NOT COPIED: `~/.rustup` and `~/.cargo`. The image has a Rust toolchain because
# `install-gg-toolchains.sh` runs `install-rust-wasm.sh`, which fails rather than skips when there is
# no rustup — but a CI agent already has the compiler `rust-toolchain.toml` selects, and dropping the
# image's rustup home on top of it would replace the compiler that is about to build the workspace.
# It is also the cheapest arm to redo: `rustup target add` over a toolchain that is already there is
# seconds. That exception is the ONLY one, and it is named here because it looks like an oversight.
#
# Usage:
#   scripts/ci/hydrate-gg-toolchains.sh <image-ref>
#   GG_CI_IMAGE=<image-ref> scripts/ci/hydrate-gg-toolchains.sh
#
# There is no default reference and there deliberately is not one: this repository names no registry
# in a script (`containers/build.sh` requires `IMAGE_REGISTRY` for the same reason), because the
# namespace is a property of the deployment doing the building and not of the source. A caller with
# nothing to pass gets the plain installer path, which is correct.
set -euo pipefail
# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

IMAGE="${1:-${GG_CI_IMAGE:-}}"

# Every `skip` below is a normal outcome, not a degraded one — see the header. It prints at a volume
# that makes the slow path explicable in a log ten minutes later, because "why did this job take
# fourteen minutes" is the question this script's failure modes actually generate.
skip() {
	log "gg toolchains: not hydrated from an image ($1)"
	echo "The pinned installer will fetch all eleven arms from upstream instead, which is the"
	echo "same result and about ten minutes slower. Nothing is wrong."
	exit 0
}

[ -n "$IMAGE" ] || skip "no image reference given; pass one, or set GG_CI_IMAGE"
command -v docker >/dev/null 2>&1 || skip "no \`docker\` on this agent"

log "pull $IMAGE"
if ! docker pull "$IMAGE"; then
	skip "\`docker pull $IMAGE\` failed — most likely the image has not been published yet, or this is a fork"
fi

# The staged copy lands OUTSIDE its destination and is merged only after `docker cp` has exited 0.
# That is not caution for its own sake: each installer's idempotence check is a stamp file at the
# ROOT of its install directory (`swift-version`, `dotnet-version`, `.teavm-version`,
# `.kotlin-version`, `wasi-sdk-version`), so a copy that died halfway could leave a stamp claiming a
# toolchain that is not all there — and the reconciler would then believe it and skip the arm. Merged
# only on success, that cannot happen: either the whole tree arrives or none of it does.
#
# The merge itself is hard links (`--link`). The staging directory is under `$HOME` and therefore on
# the same filesystem as the destination, so linking ~1.9 GB is metadata-only and effectively
# instant, where a real copy would be a second pass over every byte the pull just wrote. The staging
# directory is removed immediately afterwards, which leaves the links as the only reference — and
# because they are links rather than copies, the peak disk cost of the whole operation is one tree
# and not two.
#
# `--force` because `$HOME/.local/bin` is not empty on a real agent, and `cp --link` onto an existing
# file is an error rather than an overwrite. The image's copy is the one that should win — it is the
# pinned version, and the installer is about to check it either way — so the destination is unlinked
# first. Without this the merge aborts partway on the first collision, which is the one outcome the
# staging dance above exists to make impossible.
#
# THE IMAGE GOES TOO, and that is about disk rather than tidiness. What this script leaves behind
# otherwise is the toolchain tree TWICE — once hard-linked into `$HOME/.local` and once as unpacked
# layers in the daemon's storage — plus the ~1 GB of `~/.rustup`/`~/.cargo` the image carries and
# this script deliberately never copies out. Nothing reads any of it again: `docker cp` has already
# materialised what the reflectors want. Leaving it would be this change importing the exact disk
# problem that keeps the Azure pipeline OFF the hydration path (see the toolchain step in
# azure-pipelines.yml, where it is measured) onto the pipeline that took it. The container is
# removed first because an image cannot be removed while a container references it, even one that
# was created and never started.
#
# All of it is best-effort, like everything else here. A full disk is a reason to hurry; it is never
# a reason to fail a job whose toolchains are already in place. Doing it in the trap rather than
# after the merge covers the `skip` paths as well — a pull that succeeded and a `docker cp` that
# then did not leaves the same gigabytes behind, and that job is about to spend ten minutes
# downloading them all again from upstream.
STAGE="$HOME/.gg-ci-hydrate"
CONTAINER="gg-ci-hydrate-$$"
cleanup() {
	docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
	docker image rm "$IMAGE" >/dev/null 2>&1 || true
	rm -rf "$STAGE"
}
trap cleanup EXIT

rm -rf "$STAGE"
if ! docker create --name "$CONTAINER" "$IMAGE" >/dev/null; then
	skip "could not create a container from $IMAGE to copy out of"
fi
# `/gg-home` is the image's fixed staging home — a literal rather than a user's home directory,
# precisely so this line does not have to know what that image called its user.
if ! docker cp "$CONTAINER:/gg-home/.local" "$STAGE"; then
	skip "copying /gg-home/.local out of $IMAGE failed; nothing was merged"
fi

log "merge the image's toolchains into $HOME/.local"
mkdir -p "$HOME/.local"
cp --archive --link --force "$STAGE/." "$HOME/.local/"
rm -rf "$STAGE"

# No assertion here about which arms arrived, on purpose. The image build already asserts that every
# one of them landed at its default path (see the `test -x` block in containers/gg-ci/Dockerfile),
# and re-stating that list here would be a second copy of it that drifts the first time an arm is
# added. The real verification is the next step of the calling script: `install-gg-toolchains.sh`
# checks every pin against what is on disk and repairs whatever disagrees. Anything this hydration
# got wrong is therefore corrected rather than trusted.
du -sh "$HOME/.local" 2>/dev/null || true
log "gg toolchains hydrated from $IMAGE (the pinned installer verifies them next)"
