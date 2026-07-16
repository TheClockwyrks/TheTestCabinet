#!/usr/bin/env bash
# Locomotivation — author the yard VFX as particle SYSTEMS with the on-PATH `particle-2d`
# tool (specs/assets.md §5 — "Particle systems … played live"). Every crate shatter, squish
# impact, delivery pop, footfall puff, wheel spark and last-train vent is a SIMULATED system
# (emitters + forces + per-particle size/opacity/color curves), NOT baked frames: `render`
# emits a compact `system.json` the game plays LIVE via @test-cabinet/particle-runtime's
# ParticleCanvasPlayer (src/particles.ts). Because they are simulated they vary shot to shot —
# that variation is the point (specs/assets.md).
#
# Six systems land under assets/fx/, one per FxKind the game fires (ASSET-MANIFEST.md §5,
# src/particles.ts):
#   cargo-splinter   REQUIRED — a train smashes a package: a physical WOODEN crate shatter,
#                    shards + splinters + dust (the signature VFX; cargo.md, trains.md)
#   worker-squish    the worker is killed under a train — a sharp flatten/impact burst
#                    (hi-vis + overalls debris; character.md)
#   delivery-burst   a package is delivered to its matching zone — a satisfying gold confirm
#                    (cargo.md, flow.md)
#   footstep-dust    the worker moves (esp. sprinting) — a low warm gravel puff (character.md)
#   signal-spark     a train passes / a signal flips to danger — grinding wheel sparks + steam
#                    (trains.md)
#   last-train-smoke the last train arrives/departs — a rolling column of steam + coal smoke
#                    (trains.md, levels.md)
#
# Per-instance scale/tint (a bigger smash on a heavy load, a red vs blue crate, a fatter vent
# on the departing engine) is applied in code when the game spawns an instance at the event's
# position; one authored system serves every firing. Re-run to regenerate. The
# *.config.json / *.actions.json / *.preview.* scratch is written to a temp dir (never
# committed); only the finished system.json files under assets/fx/ are kept (see .gitignore).
#
# Usage:  bash scripts/gen-fx.sh   (particle-2d must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
#
# Coordinate convention (from the tool + the runtime, per the verified sibling-case notes):
# x across, y UP. The canvas player flips y up->down for the screen. `--dir-y 1` launches UP on
# screen; `--dir-y -1` launches DOWN; a POSITIVE `--gravity` accelerates DOWN on screen (sparks
# and debris arc up then rain down), a NEGATIVE one drifts UP (steam/smoke rises). Field is
# 128x128, centered at (64,64) — the footprint each is scaled to at spawn. Additive ("lighter")
# compositing on overlapping bright cores blows to white-hot, so hot gradients run
# white-core -> saturated palette colour, matching specs/overview.md.
set -euo pipefail

# Resolve the tool: prefer PATH, else the cargo target release dir (both here and on the run
# image, where the six tools ARE on PATH).
if ! command -v particle-2d >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FX="$ROOT/assets/fx"
mkdir -p "$FX"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# newfx <loop:true|false> <duration_ms> <out.json> : seed a fresh 128x128, 30fps system whose
#   emitted system.json lands at <out>. Preview/action scratch -> $TMP (gitignored / temp).
newfx() {
  printf '{ "width":128, "height":128, "duration_ms":%s, "fps":30, "loop":%s, "background":"transparent", "actions":"%s", "preview":"%s", "system":"%s" }\n' \
    "$2" "$1" "$TMP/actions.json" "$TMP/preview.gif" "$3" > "$CFG"
  particle-2d init --config "$CFG" >/dev/null
}
p() { particle-2d "$@" --config "$CFG" >/dev/null; }

# ============================ CARGO SPLINTER (train smashes freight — REQUIRED) ========
# The signature VFX: a train destroys a package and the WOODEN crate physically SHATTERS. A
# sharp crack-flash at impact, long timber SHARDS thrown out that arc up and rain down (velocity
# -stretched so they read as splintered planks, not dots), a spray of finer SPLINTERS, and a
# low DUST puff off the break. Neutral timber palette (bridge/sleeper timber #6a4a33 / raw wood
# #c8a878 / dark #3c2f26) so it reads for any crate colour — the game nudges the tint toward the
# smashed package's freight colour when it spawns the instance. Fires the instant a train
# overlaps freight (cargo.md destructible-cargo, trains.md lethal contact).
newfx false 640 "$FX/cargo-splinter.json"
p add-emitter --name crack --shape point --x 64 --y 64 \
  --burst 6 --at 0 --lifetime 170 --lifetime-spread 40 --speed 24 --speed-spread 12 \
  --dir-y 1 --cone-angle 360 --seed 3
p set-forces --emitter crack --drag 4.2
p set-particle --emitter crack --size-curve ease-out --size-from 1.6 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#e8d4a8@0.5,#c8a878@1"
p add-emitter --name shards --shape point --x 64 --y 64 \
  --burst 24 --at 0 --lifetime 560 --lifetime-spread 170 --speed 165 --speed-spread 72 \
  --dir-y 1 --cone-angle 360 --seed 11
p set-forces --emitter shards --gravity 340 --drag 1.3
p set-particle --emitter shards --size-curve ease-out --size-from 0.85 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.16 --rotation 120 \
  --color-gradient "#c8a878@0,#6a4a33@0.55,#3c2f26@1"
p add-emitter --name splinters --shape point --x 64 --y 64 \
  --burst 20 --at 0 --lifetime 400 --lifetime-spread 130 --speed 210 --speed-spread 85 \
  --dir-y 1 --cone-angle 360 --seed 22
p set-forces --emitter splinters --gravity 300 --drag 1.7
p set-particle --emitter splinters --size-curve ease-out --size-from 0.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.13 \
  --color-gradient "#e8d4a8@0,#8a6a45@0.5,#3c2f26@1"
p add-emitter --name dust --shape disc --x 64 --y 64 --radius 7 \
  --burst 14 --at 0 --lifetime 480 --lifetime-spread 150 --speed 48 --speed-spread 24 \
  --dir-y 1 --cone-angle 360 --seed 34
p set-forces --emitter dust --radial 40 --gravity 60 --drag 3.0
p set-particle --emitter dust --size-curve ease-out --size-from 0.7 --size-to 1.9 \
  --opacity-curve ease-out --opacity-from 0.65 --opacity-to 0.0 \
  --color-gradient "#cdbfa8@0,#8a7c6a@0.5,#463d34@1"
p set-timeline --loop false
p render
echo "produced cargo-splinter.json"

# ============================ WORKER SQUISH (the worker dies under a train, one-shot) ===
# The Frogger death: a hard, flat IMPACT the instant a train catches the worker. A blunt white
# crush-flash, a fast thin SHOCKWAVE shell snapping outward (the flatten), worker-coloured
# DEBRIS thrown out and falling (hi-vis #ffd23a + overalls #c8562e — reads as *the worker*,
# arcade not gory), and a low dust kick. Sharp and short so it lands as a single brutal beat
# (character.md death/respawn). Deliberately smaller/tighter than a train's cargo shatter.
newfx false 700 "$FX/worker-squish.json"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 8 --at 0 --lifetime 180 --lifetime-spread 40 --speed 22 --speed-spread 11 \
  --dir-y 1 --cone-angle 360 --seed 1
p set-forces --emitter flash --drag 4.4
p set-particle --emitter flash --size-curve ease-out --size-from 2.1 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffe89a@0.5,#ffd23a@1"
p add-emitter --name shock --shape point --x 64 --y 64 \
  --burst 30 --at 0 --lifetime 300 --lifetime-spread 40 --speed 205 --speed-spread 22 \
  --dir-y 1 --cone-angle 360 --seed 12
p set-forces --emitter shock --radial 65 --drag 1.0
p set-particle --emitter shock --size-curve ease-out --size-from 0.55 --size-to 0.15 \
  --opacity-curve ease-out --opacity-from 0.95 --opacity-to 0.0 --stretch 0.07 \
  --color-gradient "#ffffff@0,#ffd23a@0.4,#c8562e@1"
p add-emitter --name debris --shape point --x 64 --y 64 \
  --burst 22 --at 0 --lifetime 560 --lifetime-spread 170 --speed 150 --speed-spread 66 \
  --dir-y 1 --cone-angle 360 --seed 23
p set-forces --emitter debris --gravity 320 --drag 1.5
p set-particle --emitter debris --size-curve ease-out --size-from 0.6 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.1 --rotation 90 \
  --color-gradient "#ffd23a@0,#c8562e@0.6,#5a2c18@1"
p add-emitter --name kick --shape disc --x 64 --y 64 --radius 8 \
  --burst 12 --at 0 --lifetime 460 --lifetime-spread 140 --speed 55 --speed-spread 26 \
  --dir-y 1 --cone-angle 360 --seed 34
p set-forces --emitter kick --radial 40 --gravity 60 --drag 3.0
p set-particle --emitter kick --size-curve ease-out --size-from 0.7 --size-to 1.7 \
  --opacity-curve ease-out --opacity-from 0.6 --opacity-to 0.0 \
  --color-gradient "#cdbfa8@0,#8a7c6a@0.5,#463d34@1"
p set-timeline --loop false
p render
echo "produced worker-squish.json"

# ============================ DELIVERY BURST (package delivered to its zone, one-shot) ==
# The reward beat: a package lands on its matching drop zone and the quota ticks. A bright
# CONFIRM pop — a white/gold core flash, an expanding gold RING of sparkles (radial push, thin),
# fast gold GLINTS that arc out, and light CONFETTI motes drifting UP (negative gravity, spin)
# with a clear-signal green accent for the "matched!" read. Celebratory, clean, satisfying
# (cargo.md delivery, flow.md scoring). score/bonus gold #ffd23a, signal-clear green #46c96a.
newfx false 600 "$FX/delivery-burst.json"
p add-emitter --name pop --shape point --x 64 --y 64 \
  --burst 7 --at 0 --lifetime 200 --lifetime-spread 45 --speed 20 --speed-spread 10 \
  --dir-y 1 --cone-angle 360 --seed 2
p set-forces --emitter pop --drag 4.0
p set-particle --emitter pop --size-curve ease-out --size-from 1.8 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffe89a@0.5,#ffd23a@1"
p add-emitter --name ring --shape point --x 64 --y 64 \
  --burst 20 --at 0 --lifetime 440 --lifetime-spread 40 --speed 120 --speed-spread 16 \
  --dir-y 1 --cone-angle 360 --seed 13
p set-forces --emitter ring --radial 45 --drag 1.0
p set-particle --emitter ring --size-curve ease-out --size-from 0.5 --size-to 0.2 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#ffffff@0,#ffd23a@1"
p add-emitter --name glints --shape point --x 64 --y 64 \
  --burst 16 --at 0 --lifetime 380 --lifetime-spread 120 --speed 150 --speed-spread 64 \
  --dir-y 1 --cone-angle 360 --seed 24
p set-forces --emitter glints --gravity 150 --drag 2.0
p set-particle --emitter glints --size-curve ease-out --size-from 0.45 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.1 \
  --color-gradient "#ffffff@0,#ffd23a@0.5,#f2b03d@1"
p add-emitter --name confetti --shape point --x 64 --y 64 \
  --burst 14 --at 40 --lifetime 620 --lifetime-spread 180 --speed 66 --speed-spread 32 \
  --dir-y 1 --cone-angle 120 --seed 35
p set-forces --emitter confetti --gravity -30 --drag 1.6
p set-particle --emitter confetti --size-curve ease-out --size-from 0.55 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --rotation 140 --stretch 0.04 \
  --color-gradient "#ffe89a@0,#46c96a@0.55,#ffd23a@1"
p set-timeline --loop false
p render
echo "produced delivery-burst.json"

# ============================ FOOTSTEP DUST (worker moves, one-shot, fires OFTEN) =======
# Sells the ¾ gravel ground: a small, low puff kicked up under a footfall, wider/faster on a
# sprint. Kept cheap (few particles) and short because it fires on the walk/sprint cadence
# (character.md, assets.md). Positive gravity so it hugs the floor and settles; the game scales
# it up a touch for a sprint stride. warm gravel dust #cdbfa8 -> #6b6357 (yard ground).
newfx false 360 "$FX/footstep-dust.json"
p add-emitter --name puff --shape disc --x 64 --y 64 --radius 5 \
  --burst 8 --at 0 --lifetime 320 --lifetime-spread 90 --speed 40 --speed-spread 20 \
  --dir-y 1 --cone-angle 360 --seed 6
p set-forces --emitter puff --radial 30 --gravity 55 --drag 3.2
p set-particle --emitter puff --size-curve ease-out --size-from 0.55 --size-to 1.4 \
  --opacity-curve ease-out --opacity-from 0.6 --opacity-to 0.0 \
  --color-gradient "#cdbfa8@0,#8a7c6a@0.5,#6b6357@1"
p add-emitter --name grit --shape point --x 64 --y 64 \
  --burst 5 --at 0 --lifetime 260 --lifetime-spread 80 --speed 92 --speed-spread 40 \
  --dir-y 1 --cone-angle 200 --seed 18
p set-forces --emitter grit --gravity 240 --drag 2.0
p set-particle --emitter grit --size-curve ease-out --size-from 0.35 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 0.9 --opacity-to 0.0 --stretch 0.07 \
  --color-gradient "#cdbfa8@0,#5f574c@1"
p set-timeline --loop false
p render
echo "produced footstep-dust.json"

# ============================ SIGNAL SPARK (train passes / signal flips to danger) ======
# Telegraph polish: as a train grinds past a crossing (or a signal snaps to danger), steel
# wheels throw a shower of hot SPARKS off the rail and a quick hiss of STEAM lifts off. Sparks
# are electric white -> warning-amber #ffcf4a with a few danger-red #ff5a52 flecks (reads with
# the signal states, overview.md); they arc up and rain down, velocity-stretched like grinding
# metal. Steam is a pale whitish puff rising (negative gravity). Short, optional accent
# (trains.md telegraphing).
newfx false 560 "$FX/signal-spark.json"
p add-emitter --name sparks --shape point --x 64 --y 66 \
  --burst 18 --at 0 --lifetime 360 --lifetime-spread 120 --speed 190 --speed-spread 80 \
  --dir-y 1 --cone-angle 150 --seed 4
p set-forces --emitter sparks --gravity 280 --drag 1.5
p set-particle --emitter sparks --size-curve ease-out --size-from 0.42 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.18 \
  --color-gradient "#ffffff@0,#ffcf4a@0.6,#ff8a2a@1"
p add-emitter --name danger --shape point --x 64 --y 66 \
  --burst 7 --at 0 --lifetime 300 --lifetime-spread 90 --speed 130 --speed-spread 60 \
  --dir-y 1 --cone-angle 140 --seed 15
p set-forces --emitter danger --gravity 240 --drag 1.8
p set-particle --emitter danger --size-curve ease-out --size-from 0.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.12 \
  --color-gradient "#ffffff@0,#ff5a52@1"
p add-emitter --name steam --shape point --x 64 --y 62 \
  --burst 10 --at 0 --lifetime 520 --lifetime-spread 160 --speed 44 --speed-spread 22 \
  --dir-y 1 --cone-angle 46 --seed 26
p set-forces --emitter steam --gravity -26 --drag 2.6
p set-particle --emitter steam --size-curve ease-out --size-from 0.7 --size-to 2.2 \
  --opacity-curve ease-out --opacity-from 0.5 --opacity-to 0.0 --rotation 30 \
  --color-gradient "#eef2f7@0,#c2c9d2@0.5,#8a8f98@1"
p set-timeline --loop false
p render
echo "produced last-train-smoke pre-req (signal-spark.json)"

# ============================ LAST-TRAIN SMOKE (the last train arrives/departs) =========
# The capstone beat on last-train levels: the departing engine VENTS a rolling column of steam
# and coal smoke (trains.md, levels.md last-train). SUSTAINED via continuous `--rate` emitters
# over ~1.4s so it reads as a held chuff, not a single pop: a bright STEAM jet lifting and
# ballooning, dark rolling coal SMOKE billowing up and out, a couple of chuff PUFFs, and a few
# hot cinder EMBERS spat from the stack. Rises with negative gravity; the game anchors it at the
# stack and scales the footprint up under the engine. pale steam #eef2f7 -> warm-grey #a7b0ba;
# coal smoke #6b6357 -> charcoal #3a3d44 -> #20242c; cinders warm #ffcf4a.
newfx false 1500 "$FX/last-train-smoke.json"
p add-emitter --name chuff --shape point --x 64 --y 70 \
  --burst 10 --at 0 --lifetime 420 --lifetime-spread 120 --speed 60 --speed-spread 26 \
  --dir-y 1 --cone-angle 60 --seed 3
p set-forces --emitter chuff --gravity -20 --drag 2.4
p set-particle --emitter chuff --size-curve ease-out --size-from 1.0 --size-to 2.6 \
  --opacity-curve ease-out --opacity-from 0.7 --opacity-to 0.0 --rotation 20 \
  --color-gradient "#eef2f7@0,#c2c9d2@0.5,#8a8f98@1"
p add-emitter --name steam --shape disc --x 64 --y 68 --radius 6 \
  --rate 30 --lifetime 780 --lifetime-spread 220 --speed 66 --speed-spread 28 \
  --dir-y 1 --cone-angle 40 --seed 12
p set-forces --emitter steam --gravity -34 --drag 2.2
p set-particle --emitter steam --size-curve ease-out --size-from 1.1 --size-to 3.4 \
  --opacity-curve ease-out --opacity-from 0.55 --opacity-to 0.0 --rotation 16 \
  --color-gradient "#eef2f7@0,#c2c9d2@0.55,#a7b0ba@1"
p add-emitter --name smoke --shape disc --x 64 --y 70 --radius 8 \
  --rate 26 --lifetime 1050 --lifetime-spread 300 --speed 52 --speed-spread 26 \
  --dir-y 1 --cone-angle 90 --seed 21
p set-forces --emitter smoke --gravity -22 --drag 2.5
p set-particle --emitter smoke --size-curve ease-out --size-from 1.4 --size-to 4.2 \
  --opacity-curve ease-out --opacity-from 0.5 --opacity-to 0.0 --rotation 24 \
  --color-gradient "#6b6357@0,#3a3d44@0.5,#20242c@1"
p add-emitter --name cinders --shape point --x 64 --y 68 \
  --rate 10 --lifetime 620 --lifetime-spread 200 --speed 120 --speed-spread 55 \
  --dir-y 1 --cone-angle 34 --seed 33
p set-forces --emitter cinders --gravity 40 --drag 1.5
p set-particle --emitter cinders --size-curve ease-out --size-from 0.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.12 \
  --color-gradient "#ffffff@0,#ffcf4a@0.5,#ff8a2a@1"
p set-timeline --loop false
p render
echo "produced last-train-smoke.json"

echo "all yard particle systems produced under $FX"
