#!/usr/bin/env bash
# Frees disk on a Microsoft-hosted Ubuntu agent.
#
#   scripts/ci/free-disk.sh
#
# The hosted image arrives most of the way full of SDKs this pipeline never
# uses: the gates run inside the devcontainer image, which carries its own
# toolchains. That image, cargo's target directory and the caches fill the
# rest, and the cache save at the end of the job then fails, because it writes
# the whole cache as one archive on the same disk. Removing the unused SDKs
# frees tens of gigabytes.
#
# The image grew when it took on the browser engines the web app's tests run
# in, which are a little over a gigabyte in the container user's Playwright
# cache before the libraries they link against. The `Disk after:` line below is
# what says whether the margin is still there.
#
# Every removal is best-effort, so a change to the hosted image cannot fail the
# job here. The free space is printed before and after, which is what a cache
# save that failed for want of room is diagnosed from.
set -euo pipefail

echo "Disk before:"
df -h / || true

sudo rm -rf \
	/usr/share/dotnet \
	/opt/ghc \
	/usr/local/.ghcup \
	/opt/hostedtoolcache/CodeQL \
	/usr/local/share/powershell \
	/usr/local/share/chromium \
	/usr/local/share/boost \
	|| true

# The images the agent comes preloaded with. The job builds its own.
docker image prune --all --force >/dev/null || true

echo "Disk after:"
df -h / || true
