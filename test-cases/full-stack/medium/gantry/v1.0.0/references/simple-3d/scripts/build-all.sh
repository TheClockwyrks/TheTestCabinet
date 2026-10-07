#!/usr/bin/env bash
# Gantry — reproduce every produced asset from nothing.
#
# `specs/assets.md` is the contract: the game ships no pre-made art, and every
# model and sound under `assets/` is produced with the tools this machine carries
# on its `PATH` (`voxel`, `sfx-synth`, `sfx-sample`, `music`). Production is a
# one-time development step — the produced files are committed and the build
# bundles them, so `npm ci` and `npm run build` invoke no tool.
#
# This script exists so that claim is checkable: it re-runs every per-asset build
# and copies the results into `assets/`. Each subdirectory under `models/` and
# `audio/` holds one asset's `build.sh` and the tool config it reads.
#
# Usage:  bash scripts/build-all.sh
set -euo pipefail

for tool in voxel sfx-synth sfx-sample music; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
		[ -x "$REL/$tool" ] || {
			echo "$tool not found on PATH or in $REL" >&2
			exit 1
		}
		export PATH="$REL:$PATH"
	fi
done

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
mkdir -p "$ROOT/assets/models" "$ROOT/assets/audio"

MODELS="ring trolley hook counterweight mount crate container drum"
SOUNDS="place delete run-start attach placed creak break collapse complete fail motor"

for m in $MODELS; do
	echo "== model $m"
	(cd "$HERE/models/$m" && bash build.sh >/dev/null)
	cp "$HERE/models/$m/mesh.glb" "$ROOT/assets/models/$m.glb"
done

for s in $SOUNDS; do
	echo "== sound $s"
	(cd "$HERE/audio/$s" && bash build.sh >/dev/null)
	cp "$HERE/audio/$s/$s.wav" "$ROOT/assets/audio/$s.wav"
done

echo "== music"
(cd "$HERE/audio/music" && bash build.sh >/dev/null)
cp "$HERE/audio/music/music.wav" "$HERE/audio/music/music.mid" "$ROOT/assets/audio/"

# A produced file that came back empty is a silent failure, so refuse one.
fail=0
for m in $MODELS; do
	sz=$(stat -c%s "$ROOT/assets/models/$m.glb")
	[ "$sz" -ge 2048 ] || {
		echo "assets/models/$m.glb is $sz bytes — empty model" >&2
		fail=1
	}
done
for s in $SOUNDS music; do
	sz=$(stat -c%s "$ROOT/assets/audio/$s.wav")
	[ "$sz" -ge 2048 ] || {
		echo "assets/audio/$s.wav is $sz bytes — empty clip" >&2
		fail=1
	}
done
[ "$fail" -eq 0 ] || exit 1

echo "all 21 produced files rebuilt into assets/"
