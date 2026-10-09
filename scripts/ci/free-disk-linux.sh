#!/usr/bin/env bash
# Reclaims disk on the CI agents before a job that needs more of it than the image ships with.
#
# The hosted ubuntu-24.04 image ships ~80% full with preinstalled SDKs this
# pipeline never touches (.NET, the Android SDK, Haskell/GHC, CodeQL bundles, and
# preloaded Docker images). The workspace's cargo `target/` on top tips `/` past
# the agent's 5% free-space monitor and — the failure this fixes — makes the
# "Cache cargo target" SAVE die when `tar` runs out of room mid-write
# ("Wrote only N of M bytes ... Error is not recoverable"). Deleting the unused
# toolchains frees ~24 GB (57G used -> 33G, leaving ~40G free).
#
# That reclaim alone is NOT sufficient and never was: `target/` reached ~36 GB, so
# the tree plus the tar the cache save writes beside it still ran the disk out.
# The other half of the fix is capping dev/test debug info to line tables
# (CARGO_PROFILE_DEV_DEBUG on every Rust job), which takes `target/` to
# ~14 GB. Both are needed: keep this script when touching that setting.
#
# The contracts and suites crates (October 2026) took the pruned `target/` to
# ~17 GB, and both Rust jobs' cache saves ran the disk out again (95-97% used,
# "No space left on device"): the tree plus a tar of it no longer fit beside
# what the reclaim left. So the reclaim also takes the whole tool cache (every
# Python, PyPy, Ruby, Go and Node the image preinstalls, not just CodeQL), Swift,
# the Google Cloud and AWS CLIs, vcpkg, and the Edge and Chrome installs. No job
# that runs this uses any of them on the host: the checks run inside the CI
# images, gg's Node is downloaded by gg-ci-toolchains.sh, and the host's own
# tasks are Cache, Docker, AzureCLI (az lives in /opt/az, which stays) and the
# test-result publish, which run on the agent's bundled Node.
#
# Azure-only and Linux-only. The Windows `binary` leg skips this (its step is gated on
# Agent.OS). The GitHub workflows have not hit this and are left alone.
#
# THE RUN-IMAGE JOB RUNS IT ON BOTH ARCHITECTURES, and it is the one job that does; every
# other caller is gated on amd64. It is also the one job that ran out of disk on both, which
# is why it gets the arm64 pass the others do not need.
#
# WHAT THE arm64 POOL ACTUALLY IS, since running host-wide removals on it is only safe if it
# is disposable. `pool-dev-linux-arm64-wus3-4c-eph-01` is an Azure Managed DevOps Pool
# (agent cloud "DevOpsInfrastructure Pool Provider rm-prod"), not a hand-run box: four agents
# on Ubuntu 24.04, each reported with its own `provisioningState`, and every job gets a fresh
# VM. That is measured, not assumed — in the last run of the image jobs the arm64 legs never
# overlapped in time, each was preceded by a ~2.5 minute provisioning gap, and a service-image
# job that landed on the same agent slot half an hour after the run-image job pulled
# `rust:1-bookworm` and `debian:bookworm-slim` from Docker Hub completely cold. So there is no warm store to
# protect and no concurrent job on the same daemon to disturb, and the image prune below is a
# near no-op there rather than a hazard. Being an Ubuntu 24.04 runner image it also carries
# most of the toolchain paths below, so the removals are worth making.
#
# EVERY REMOVAL IS BEST-EFFORT, and that is a contract rather than an aside: this script frees
# disk for a build, it is not a gate on anything, and a red "Reclaim agent disk" step would
# fail a job that had not yet built a thing. So sudo is probed for USABILITY rather than for
# presence (`command -v sudo` succeeds on an agent whose sudo then prompts for a password, and
# under `set -euo pipefail` that ends the script), and the removals themselves cannot fail the
# step either — a path that turns out to be a busy mountpoint is the same non-event as a path
# that is not there.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

# The readings come from scripts/ci/report-disk.sh, which reports the container store's
# filesystem and the agent work folder as well as `/` — on the arm64 agents those are not the
# same mount, and `/` alone is how the last disk failure arrived with no usable figure. It is a
# separate script rather than a helper in tcab-lib.sh because pipeline steps also call it on its
# own, around the run-image build.
readonly REPORT_DISK="${CI_LIB_DIR}/report-disk.sh"

"$REPORT_DISK" "before reclaim"

# Unused language runtimes/SDKs and prebuilt tool bundles. These are the canonical
# large, safe-to-drop directories on the hosted Ubuntu image; none is a build
# dependency of the Rust crates or the contract codegen.
if ! sudo -n true 2>/dev/null; then
	log "no usable passwordless sudo on this agent; skipping the toolchain removals and the image prune"
else
	log "removing unused preinstalled toolchains"
	# `|| true`: see the best-effort contract above. `rm -rf` already ignores a missing path,
	# so what this covers is a path that exists and refuses to go.
	sudo rm -rf \
		/usr/share/dotnet \
		/usr/local/lib/android \
		/opt/ghc \
		/usr/local/.ghcup \
		/opt/hostedtoolcache \
		/usr/local/share/powershell \
		/usr/local/share/chromium \
		/usr/local/share/boost \
		/usr/share/swift \
		/usr/lib/google-cloud-sdk \
		/usr/local/share/vcpkg \
		/opt/microsoft \
		/opt/google \
		/usr/local/aws-cli \
		/usr/local/aws-sam-cli \
		|| true

	# Preloaded container images: no build here starts from any of them, so they are
	# dead weight. `--all` rather than dangling-only because on both pools the agent is a
	# single-use VM whose store this job is the first to use, so a tagged image present now is
	# something the image shipped and not something a build wants (measured; see the header).
	# Guarded so a missing daemon or empty image list never fails the step.
	log "pruning preloaded Docker images"
	sudo docker image prune --all --force || true
fi

"$REPORT_DISK" "after reclaim"
