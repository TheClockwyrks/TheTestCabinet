#!/usr/bin/env bash
# Deepcore — author the underground VFX as particle SYSTEMS with the on-PATH `particle-2d`
# tool (specs/assets.md — "Particle systems … played live"). Every drill-chip spray, jetpack
# plume, ore glint, gas blast, lava sizzle, dust puff, core pulse, detonation, launch column
# and death vent is a SIMULATED system (emitters + forces + per-particle size/opacity/color
# curves), NOT baked frames: `render` emits a compact `system.json` the game plays LIVE via
# @test-cabinet/particle-runtime's ParticleCanvasPlayer. Because they are simulated they vary
# shot to shot — that variation is the point (specs/assets.md).
#
# Twelve systems land under assets/fx/, one per effect the game loads (ASSET-LAYOUT.md):
#   drill-debris     the miner drills a tile — rock chips + dust off the bit (character.md)
#   jetpack-exhaust  the miner thrusts — a downward hot plume + sparks (character.md)
#   ore-sparkle      an ore vein is collected — a brief bright glint (mining.md)
#   material-shimmer a Resonite/Cryenite node is collected — a richer prize shimmer (mining.md)
#   gas-explosion    a gas pocket detonates — a violent green-white burst + debris (hazards.md)
#   lava-embers      the miner touches lava — a sizzle of embers + smoke (hazards.md)
#   impact-dust      the miner lands hard — a low puff of dust (hazards.md)
#   core-extract     the Core Sample is taken — an ominous swirling energy pulse (hazards.md)
#   core-detonation  the Core timer expires — a HUGE lethal blast, far bigger than gas (hazards.md)
#   launch-exhaust   the rocket launches — a roaring sustained exhaust column + smoke (rocket.md)
#   death-burst      the miner dies — a suit-venting / debris burst (character.md, modes.md)
#
# Per-instance scale (a bigger drill on hard rock, a fatter thrust on a long hold) is applied
# in code when the game spawns an instance at the event's position; one authored system serves
# every firing. Re-run to regenerate. The *.config.json / *.actions.json / *.preview.* scratch
# is written to a temp dir (never committed); only the finished system.json files under
# assets/fx/ are kept (see .gitignore).
#
# Usage:  bash scripts/gen-fx.sh   (particle-2d must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
#
# Coordinate convention (from the tool + the runtime, per the verified Arc Foundry / Junction
# notes): x across, y UP. The canvas player flips y up->down for the screen. `dir-y 1` launches
# UP on screen; `dir-y -1` launches DOWN; a POSITIVE `--gravity` accelerates DOWN on screen
# (sparks/debris rain, flares slow as they rise), a NEGATIVE one drifts UP (smoke rises). Field
# is 128x128, centered at (64,64) — the footprint each is scaled to at spawn. Additive
# ("lighter") compositing blows overlapping bright cores to white-hot, so gradients run
# white-core -> saturated effect colour, matching the palette in specs/overview.md.
set -euo pipefail

# Resolve the tool: prefer PATH, else the cargo target release dir (both here and on the run
# image, where the six tools ARE on PATH).
if ! command -v draw >/dev/null 2>&1; then
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

# ============================ GAS SEEP (the ONLY tell a hidden gas pocket is there) ====
# A gas pocket is drawn as ordinary band rock (hidden, specs/hazards.md); this SUBTLE wisp is
# its only tell — a faint breath of pale-green gas that rises slowly and fades. It must stay
# subtle (a hurried dig misses it) but it also has to actually READ against the grey rockbed
# rock if a careful eye is on the tile — the earlier version was so faint it was invisible, so
# the opacity and green are nudged up a touch and there's one more wisp. The sim now steps
# through the on-screen pockets round-robin (game.emitGasSeeps), so every pocket seeps in turn.
# The emitter disc is centered and widened so a burst spreads ACROSS the tile face rather than a
# tiny central patch (game.emitGasSeeps also scatters each burst's origin over the whole tile).
# Composited "over" (not additive) so it stays a soft haze, never a bright glow.
newfx false 950 "$FX/gas-seep.json"
p add-emitter --name seep --shape disc --x 64 --y 64 --radius 12 \
  --burst 4 --at 0 --lifetime 860 --lifetime-spread 220 --speed 13 --speed-spread 5 \
  --dir-y -1 --cone-angle 34 --seed 7
p set-forces --emitter seep --gravity -15 --drag 3.0
p set-particle --emitter seep --size-curve ease-out --size-from 0.4 --size-to 1.4 \
  --opacity-curve ease-out --opacity-from 0.34 --opacity-to 0.0 \
  --color-gradient "#b6ec66@0,#8fd23a@1"
p set-timeline --loop false
p render
echo "produced gas-seep.json"

# ============================ DRILL DEBRIS (bit bites rock, one-shot, fires often) =====
# The drill chews a tile: a low spray of rock chips that arc up and rain down, plus a soft
# dust puff at the bit. Neutral warm-grey rock so it reads for any band (the game nudges the
# tint to the band being dug). Short + cheap because it fires every drilling frame.
newfx false 380 "$FX/drill-debris.json"
p add-emitter --name chips --shape point --x 64 --y 64 \
  --burst 16 --at 0 --lifetime 360 --lifetime-spread 120 --speed 122 --speed-spread 55 \
  --dir-y 1 --cone-angle 360 --seed 3
p set-forces --emitter chips --gravity 300 --drag 1.8
p set-particle --emitter chips --size-curve ease-out --size-from 0.62 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.06 \
  --color-gradient "#cdbfa8@0,#8a8f98@0.45,#4a4e56@1"
p add-emitter --name dust --shape disc --x 64 --y 64 --radius 6 \
  --burst 10 --at 0 --lifetime 320 --lifetime-spread 90 --speed 40 --speed-spread 20 \
  --dir-y 1 --cone-angle 360 --seed 12
p set-forces --emitter dust --gravity 60 --drag 3.2
p set-particle --emitter dust --size-curve ease-out --size-from 0.7 --size-to 1.5 \
  --opacity-curve ease-out --opacity-from 0.7 --opacity-to 0.0 \
  --color-gradient "#cdbfa8@0,#8a7c6a@1"
p set-timeline --loop false
p render
echo "produced drill-debris.json"

# ============================ JETPACK EXHAUST (thrust plume, one-shot, pulses with hold) =
# The jetpack fires: a hot plume of exhaust blasting straight DOWN under the nozzle, a bright
# inner glow, and a few fast sparks. Short so re-spawning each thrust frame reads as a plume
# pulsing with the hold. jetpack flame #ffa63a over a fuel-gold #ffcf4a core.
newfx false 340 "$FX/jetpack-exhaust.json"
p add-emitter --name glow --shape point --x 64 --y 66 \
  --burst 5 --at 0 --lifetime 180 --lifetime-spread 40 --speed 20 --speed-spread 10 \
  --dir-y -1 --cone-angle 360 --seed 2
p set-forces --emitter glow --drag 4.0
p set-particle --emitter glow --size-curve ease-out --size-from 1.4 --size-to 0.2 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffa63a@1"
p add-emitter --name plume --shape point --x 64 --y 66 \
  --burst 16 --at 0 --lifetime 320 --lifetime-spread 90 --speed 92 --speed-spread 32 \
  --dir-y -1 --cone-angle 28 --seed 9
p set-forces --emitter plume --gravity 40 --drag 2.2
p set-particle --emitter plume --size-curve ease-out --size-from 1.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.1 \
  --color-gradient "#ffffff@0,#ffcf4a@0.4,#ffa63a@1"
p add-emitter --name sparks --shape point --x 64 --y 66 \
  --burst 10 --at 0 --lifetime 260 --lifetime-spread 80 --speed 150 --speed-spread 60 \
  --dir-y -1 --cone-angle 42 --seed 21
p set-forces --emitter sparks --gravity 120 --drag 1.8
p set-particle --emitter sparks --size-curve ease-out --size-from 0.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.14 \
  --color-gradient "#ffffff@0,#ffcf4a@1"
p set-timeline --loop false
p render
echo "produced jetpack-exhaust.json"

# ============================ ORE SPARKLE (vein collected, one-shot) ==================
# A brief bright glint at the pickup: a white pin-flash and a few gold glints that arc out and
# fall. The game tints it to the ore collected; the neutral bright-gold core reads for all six.
newfx false 420 "$FX/ore-sparkle.json"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 5 --at 0 --lifetime 160 --lifetime-spread 40 --speed 18 --speed-spread 9 \
  --dir-y 1 --cone-angle 360 --seed 5
p set-forces --emitter flash --drag 5
p set-particle --emitter flash --size-curve ease-out --size-from 1.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffcf4a@1"
p add-emitter --name glints --shape point --x 64 --y 64 \
  --burst 13 --at 0 --lifetime 320 --lifetime-spread 100 --speed 122 --speed-spread 55 \
  --dir-y 1 --cone-angle 360 --seed 16
p set-forces --emitter glints --gravity 120 --drag 2.2
p set-particle --emitter glints --size-curve ease-out --size-from 0.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.1 \
  --color-gradient "#ffffff@0,#ffd23a@0.5,#ffa63a@1"
p set-timeline --loop false
p render
echo "produced ore-sparkle.json"

# ============================ MATERIAL SHIMMER (Resonite/Cryenite, one-shot) ==========
# The prize find (not routine ore): a richer, distinct shimmer — motes CONVERGE inward with a
# swirling turbulence, collapse into a bright flash, throw an expanding shimmer ring, and rising
# motes drift up. Resonite blue #4ad0ff <-> Cryenite violet #b98cff so it reads exotic.
newfx false 700 "$FX/material-shimmer.json"
p add-emitter --name converge --shape disc --x 64 --y 64 --radius 26 \
  --burst 26 --at 0 --lifetime 420 --lifetime-spread 90 --speed 7 --speed-spread 4 \
  --dir-y 1 --cone-angle 360 --seed 4
p set-forces --emitter converge --radial -160 --vortex 40 --turbulence 18,0.05 --drag 1.2
p set-particle --emitter converge --size-curve ease-in --size-from 0.7 --size-to 0.15 \
  --opacity-curve ease-in-out --opacity-from 0.85 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#eaf6ff@0,#4ad0ff@0.6,#b98cff@1"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 9 --at 230 --lifetime 260 --lifetime-spread 60 --speed 26 --speed-spread 13 \
  --dir-y 1 --cone-angle 360 --seed 14
p set-forces --emitter flash --drag 4.0
p set-particle --emitter flash --size-curve ease-out --size-from 1.9 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#4ad0ff@1"
p add-emitter --name ring --shape point --x 64 --y 64 \
  --burst 18 --at 230 --lifetime 460 --lifetime-spread 40 --speed 110 --speed-spread 14 \
  --dir-y 1 --cone-angle 360 --seed 27
p set-forces --emitter ring --radial 40 --drag 1.0
p set-particle --emitter ring --size-curve ease-out --size-from 0.5 --size-to 0.2 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#ffffff@0,#4ad0ff@1"
p add-emitter --name motes --shape point --x 64 --y 64 \
  --burst 16 --at 230 --lifetime 560 --lifetime-spread 160 --speed 60 --speed-spread 30 \
  --dir-y 1 --cone-angle 360 --seed 34
p set-forces --emitter motes --gravity -22 --drag 1.6
p set-particle --emitter motes --size-curve ease-out --size-from 0.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --rotation 90 --stretch 0.04 \
  --color-gradient "#ffffff@0,#b98cff@0.5,#4ad0ff@1"
p set-timeline --loop false
p render
echo "produced material-shimmer.json"

# ============================ GAS EXPLOSION (pocket detonates, one-shot) ==============
# Drilling into a gas pocket: a VIOLENT green-white detonation — a hard white flash blooming to
# toxic green, a fast concussive shockwave RING, an outward shell, flying rock debris, and inner
# crackle. This is the "you hit gas" read and the playtest wanted it to hit HARD (it pairs with a
# screen shake + knockback in code), so the flash is bigger and there's a ring + more shell/debris
# than before. gas pocket #9ad24a; debris is rock grey. Still clearly smaller than core-detonation.
newfx false 780 "$FX/gas-explosion.json"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 14 --at 0 --lifetime 220 --lifetime-spread 55 --speed 34 --speed-spread 18 \
  --dir-y 1 --cone-angle 360 --seed 1
p set-forces --emitter flash --drag 4
p set-particle --emitter flash --size-curve ease-out --size-from 3.2 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#dfffb0@0.5,#9ad24a@1"
# A concussive shockwave: a thin ring of particles seeded on a disc and driven hard OUTWARD by
# a strong radial force, reading as a fast expanding bright ring (there is no `ring` shape, so
# a disc + radial is the idiom).
p add-emitter --name ring --shape disc --x 64 --y 64 --radius 7 \
  --burst 40 --at 0 --lifetime 300 --lifetime-spread 40 --speed 60 --speed-spread 20 \
  --dir-y 1 --cone-angle 360 --seed 5
p set-forces --emitter ring --radial 260 --drag 5.5
p set-particle --emitter ring --size-curve ease-out --size-from 1.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 0.95 --opacity-to 0.0 --stretch 0.14 \
  --color-gradient "#ffffff@0,#c7f07a@0.4,#9ad24a@1"
p add-emitter --name shell --shape point --x 64 --y 64 \
  --burst 48 --at 0 --lifetime 500 --lifetime-spread 140 --speed 185 --speed-spread 66 \
  --dir-y 1 --cone-angle 360 --seed 12
p set-forces --emitter shell --radial 70 --gravity 90 --drag 1.6
p set-particle --emitter shell --size-curve ease-out --size-from 0.85 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.08 \
  --color-gradient "#ffffff@0,#c7f07a@0.35,#9ad24a@1"
p add-emitter --name debris --shape point --x 64 --y 64 \
  --burst 22 --at 0 --lifetime 600 --lifetime-spread 180 --speed 195 --speed-spread 78 \
  --dir-y 1 --cone-angle 360 --seed 23
p set-forces --emitter debris --gravity 260 --drag 1.4
p set-particle --emitter debris --size-curve ease-out --size-from 0.7 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.1 \
  --color-gradient "#8a8f98@0,#3a3d44@1"
p add-emitter --name crackle --shape point --x 64 --y 64 \
  --burst 16 --at 0 --lifetime 320 --lifetime-spread 90 --speed 100 --speed-spread 55 \
  --dir-y 1 --cone-angle 360 --seed 30
p set-forces --emitter crackle --drag 2.8
p set-particle --emitter crackle --size-curve ease-out --size-from 0.45 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#ffffff@0,#9ad24a@1"
p set-timeline --loop false
p render
echo "produced gas-explosion.json"

# ============================ LAVA EMBERS (lava contact, one-shot) ====================
# The miner brushes lava: a sizzle of glowing embers spitting up, fast sputter sparks, and dark
# smoke rising off the contact point. Gentle and hot, not an explosion. lava #ff5220 / core
# glow #ff6a2a embers, smoke drifting UP (negative gravity).
newfx false 820 "$FX/lava-embers.json"
p add-emitter --name embers --shape point --x 64 --y 64 \
  --burst 18 --at 0 --lifetime 640 --lifetime-spread 190 --speed 70 --speed-spread 35 \
  --dir-y 1 --cone-angle 60 --seed 6
p set-forces --emitter embers --gravity 120 --drag 1.6
p set-particle --emitter embers --size-curve ease-out --size-from 0.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.06 \
  --color-gradient "#ffe0a0@0,#ff6a2a@0.5,#ff5220@1"
p add-emitter --name sputter --shape point --x 64 --y 64 \
  --burst 12 --at 0 --lifetime 280 --lifetime-spread 80 --speed 130 --speed-spread 55 \
  --dir-y 1 --cone-angle 90 --seed 17
p set-forces --emitter sputter --gravity 200 --drag 2.2
p set-particle --emitter sputter --size-curve ease-out --size-from 0.35 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.09 \
  --color-gradient "#ffffff@0,#ff8a3a@1"
p add-emitter --name smoke --shape point --x 64 --y 62 \
  --burst 10 --at 0 --lifetime 780 --lifetime-spread 220 --speed 40 --speed-spread 20 \
  --dir-y 1 --cone-angle 40 --seed 29
p set-forces --emitter smoke --gravity -18 --drag 2.6
p set-particle --emitter smoke --size-curve ease-out --size-from 0.8 --size-to 2.0 \
  --opacity-curve ease-out --opacity-from 0.5 --opacity-to 0.0 --rotation 40 \
  --color-gradient "#3a2c1f@0,#20242c@1"
p set-timeline --loop false
p render
echo "produced lava-embers.json"

# ============================ IMPACT DUST (hard landing, one-shot) ====================
# A hard touchdown kicks up a low, wide puff of dust that spreads outward and settles, plus a
# few small chips. Kept low with a positive gravity so it hugs the floor. warm rock dust.
newfx false 600 "$FX/impact-dust.json"
p add-emitter --name puff --shape disc --x 64 --y 64 --radius 8 \
  --burst 22 --at 0 --lifetime 520 --lifetime-spread 150 --speed 60 --speed-spread 28 \
  --dir-y 1 --cone-angle 360 --seed 7
p set-forces --emitter puff --radial 55 --gravity 70 --drag 2.8
p set-particle --emitter puff --size-curve ease-out --size-from 0.6 --size-to 1.6 \
  --opacity-curve ease-out --opacity-from 0.75 --opacity-to 0.0 \
  --color-gradient "#cdbfa8@0,#8a7c6a@0.5,#3a3d44@1"
p add-emitter --name chips --shape point --x 64 --y 64 \
  --burst 10 --at 0 --lifetime 300 --lifetime-spread 90 --speed 100 --speed-spread 45 \
  --dir-y 1 --cone-angle 360 --seed 20
p set-forces --emitter chips --gravity 220 --drag 2.0
p set-particle --emitter chips --size-curve ease-out --size-from 0.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.07 \
  --color-gradient "#cdbfa8@0,#6b6f78@1"
p set-timeline --loop false
p render
echo "produced impact-dust.json"

# ============================ CORE EXTRACT (Sample taken, one-shot — ominous) =========
# The moment the Core Sample is pulled, the destabilization timer starts. NOT an explosion — an
# ominous pulse of energy: motes gather INWARD on a slow vortex swirl, collapse into a dull
# flash, throw a slow warning ring, and unstable energy rises off the core. deep core-red
# #ff4a2a / core glow #ff6a2a fading to a charred #7a1a0a — menace, not payoff.
newfx false 920 "$FX/core-extract.json"
p add-emitter --name gather --shape disc --x 64 --y 64 --radius 30 \
  --burst 26 --at 0 --lifetime 520 --lifetime-spread 120 --speed 6 --speed-spread 4 \
  --dir-y 1 --cone-angle 360 --seed 8
p set-forces --emitter gather --radial -140 --vortex 60 --turbulence 16,0.05 --drag 1.1
p set-particle --emitter gather --size-curve ease-in --size-from 0.7 --size-to 0.1 \
  --opacity-curve ease-in-out --opacity-from 0.8 --opacity-to 0.0 --stretch 0.04 \
  --color-gradient "#ff6a2a@0,#ff4a2a@0.6,#7a1a0a@1"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 7 --at 260 --lifetime 300 --lifetime-spread 70 --speed 22 --speed-spread 11 \
  --dir-y 1 --cone-angle 360 --seed 18
p set-forces --emitter flash --drag 4
p set-particle --emitter flash --size-curve ease-out --size-from 1.8 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 0.9 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ff6a2a@1"
p add-emitter --name ring --shape point --x 64 --y 64 \
  --burst 20 --at 260 --lifetime 620 --lifetime-spread 50 --speed 90 --speed-spread 14 \
  --dir-y 1 --cone-angle 360 --seed 25
p set-forces --emitter ring --radial 30 --drag 0.9
p set-particle --emitter ring --size-curve ease-out --size-from 0.5 --size-to 0.25 \
  --opacity-curve ease-out --opacity-from 0.9 --opacity-to 0.0 --stretch 0.04 \
  --color-gradient "#ffcf9a@0,#ff4a2a@1"
p add-emitter --name rise --shape point --x 64 --y 64 \
  --burst 14 --at 0 --lifetime 700 --lifetime-spread 200 --speed 46 --speed-spread 24 \
  --dir-y 1 --cone-angle 50 --seed 32
p set-forces --emitter rise --gravity -14 --drag 1.8
p set-particle --emitter rise --size-curve ease-out --size-from 0.45 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 0.9 --opacity-to 0.0 --rotation 60 --stretch 0.05 \
  --color-gradient "#ff8a3a@0,#ff4a2a@1"
p set-timeline --loop false
p render
echo "produced core-extract.json"

# ============================ CORE DETONATION (timer expires — the LETHAL climax) =====
# The Core Sample goes off: a HUGE, violent explosion — deliberately far bigger than a gas
# blast (higher counts, higher speeds, more layers, a longer burn). A blinding flash, a boiling
# fireball, a fast shockwave shell, flying debris that trails smoke as it dies (a subemitter),
# lingering embers, and a rising billow of black smoke. white -> fuel-gold #ffcf4a -> lava
# #ff5220 / core-red #ff4a2a -> charred #7a1a0a. This is the dramatic death read.
newfx false 1400 "$FX/core-detonation.json"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 16 --at 0 --lifetime 300 --lifetime-spread 70 --speed 40 --speed-spread 20 \
  --dir-y 1 --cone-angle 360 --seed 1
p set-forces --emitter flash --drag 4
p set-particle --emitter flash --size-curve ease-out --size-from 3.2 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffcf4a@0.5,#ff4a2a@1"
p add-emitter --name fireball --shape disc --x 64 --y 64 --radius 8 \
  --burst 46 --at 0 --lifetime 620 --lifetime-spread 160 --speed 150 --speed-spread 55 \
  --dir-y 1 --cone-angle 360 --seed 11
p set-forces --emitter fireball --radial 90 --gravity 40 --drag 1.5
p set-particle --emitter fireball --size-curve ease-out --size-from 1.2 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.06 \
  --color-gradient "#ffffff@0,#ffcf4a@0.35,#ff5220@0.7,#7a1a0a@1"
p add-emitter --name shockwave --shape point --x 64 --y 64 \
  --burst 40 --at 0 --lifetime 640 --lifetime-spread 40 --speed 235 --speed-spread 18 \
  --dir-y 1 --cone-angle 360 --seed 21
p set-forces --emitter shockwave --radial 70 --drag 0.7
p set-particle --emitter shockwave --size-curve ease-out --size-from 0.7 --size-to 0.25 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#ffffff@0,#ffcf4a@0.4,#ff4a2a@1"
# Flying debris that TRAILS smoke (a child emitter bursting as each chunk dies).
p add-emitter --name debris --shape point --x 64 --y 64 \
  --burst 30 --at 0 --lifetime 900 --lifetime-spread 260 --speed 220 --speed-spread 90 \
  --dir-y 1 --cone-angle 360 --seed 26
p set-forces --emitter debris --gravity 320 --drag 1.2
p set-particle --emitter debris --size-curve ease-out --size-from 0.8 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.1 \
  --color-gradient "#8a8f98@0,#3a1512@1"
p add-emitter --name debris-smoke --shape point --x 64 --y 64 \
  --burst 2 --at 0 --lifetime 620 --lifetime-spread 180 --speed 18 --speed-spread 10 \
  --dir-y 1 --cone-angle 360 --seed 41
p set-forces --emitter debris-smoke --gravity -10 --drag 2.6
p set-particle --emitter debris-smoke --size-curve ease-out --size-from 0.8 --size-to 2.2 \
  --opacity-curve ease-out --opacity-from 0.5 --opacity-to 0.0 \
  --color-gradient "#3a1512@0,#20242c@1"
p add-subemitter --parent debris --on death --emitter debris-smoke
p add-emitter --name embers --shape point --x 64 --y 64 \
  --burst 24 --at 0 --lifetime 1100 --lifetime-spread 320 --speed 120 --speed-spread 60 \
  --dir-y 1 --cone-angle 360 --seed 36
p set-forces --emitter embers --gravity 260 --drag 1.3
p set-particle --emitter embers --size-curve ease-out --size-from 0.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.06 \
  --color-gradient "#ffcf4a@0,#ff5220@0.5,#ff4a2a@1"
p add-emitter --name billow --shape point --x 64 --y 64 \
  --burst 14 --at 60 --lifetime 1000 --lifetime-spread 260 --speed 55 --speed-spread 26 \
  --dir-y 1 --cone-angle 70 --seed 45
p set-forces --emitter billow --gravity -24 --drag 2.4
p set-particle --emitter billow --size-curve ease-out --size-from 1.4 --size-to 3.4 \
  --opacity-curve ease-out --opacity-from 0.55 --opacity-to 0.0 --rotation 30 \
  --color-gradient "#3a1512@0,#0c0f14@1"
p set-timeline --loop false
p render
echo "produced core-detonation.json"

# ============================ LAUNCH EXHAUST (rocket lifts off — the victory payoff) ===
# The rocket fires and climbs: a ROARING, SUSTAINED column of exhaust blasting DOWN off the pad
# (continuous `--rate` emitters over ~1.6s so it reads as a held burn, not a single pop), a
# blinding ignition flash, fast ejected sparks, and great rolling clouds of smoke billowing out
# and up around the base. Big and dramatic — the run's reward. fuel-gold #ffcf4a / flame
# #ffa63a core, warm-grey -> charcoal smoke. The game scales the footprint up under the rocket.
newfx false 1600 "$FX/launch-exhaust.json"
p add-emitter --name ignition --shape point --x 64 --y 74 \
  --burst 14 --at 0 --lifetime 320 --lifetime-spread 80 --speed 40 --speed-spread 20 \
  --dir-y 1 --cone-angle 360 --seed 2
p set-forces --emitter ignition --drag 4
p set-particle --emitter ignition --size-curve ease-out --size-from 2.6 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffcf4a@1"
p add-emitter --name flame --shape point --x 64 --y 78 \
  --rate 40 --lifetime 260 --lifetime-spread 70 --speed 60 --speed-spread 25 \
  --dir-y -1 --cone-angle 14 --seed 9
p set-forces --emitter flame --drag 2.2
p set-particle --emitter flame --size-curve ease-out --size-from 1.8 --size-to 0.3 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffcf4a@1"
p add-emitter --name column --shape point --x 64 --y 78 \
  --rate 90 --lifetime 420 --lifetime-spread 120 --speed 150 --speed-spread 40 \
  --dir-y -1 --cone-angle 22 --seed 15
p set-forces --emitter column --gravity 30 --drag 1.6
p set-particle --emitter column --size-curve ease-out --size-from 1.2 --size-to 0.2 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.12 \
  --color-gradient "#ffffff@0,#ffcf4a@0.4,#ffa63a@1"
p add-emitter --name sparks --shape point --x 64 --y 78 \
  --rate 50 --lifetime 520 --lifetime-spread 160 --speed 210 --speed-spread 70 \
  --dir-y -1 --cone-angle 30 --seed 24
p set-forces --emitter sparks --gravity 60 --drag 1.3
p set-particle --emitter sparks --size-curve ease-out --size-from 0.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.16 \
  --color-gradient "#ffffff@0,#ffa63a@1"
p add-emitter --name smoke --shape disc --x 64 --y 60 --radius 10 \
  --rate 34 --lifetime 1000 --lifetime-spread 300 --speed 65 --speed-spread 32 \
  --dir-y 1 --cone-angle 130 --seed 33
p set-forces --emitter smoke --gravity -20 --drag 2.4
p set-particle --emitter smoke --size-curve ease-out --size-from 1.6 --size-to 4.0 \
  --opacity-curve ease-out --opacity-from 0.5 --opacity-to 0.0 --rotation 20 \
  --color-gradient "#8a7c6a@0,#3a3d44@0.5,#20242c@1"
p set-timeline --loop false
p render
echo "produced launch-exhaust.json"

# ============================ DEATH BURST (the miner dies, one-shot) ==================
# The suit fails: a hull-cyan flash, jets of venting steam/gas (hull #46d6e6), suit debris
# thrown out and falling, and a red alert crackle. Marks the death without stealing the moment
# from the core detonation (this is the smaller, personal burst). suit-lamp #ffcf9a debris,
# alert #ff5a52.
newfx false 820 "$FX/death-burst.json"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 8 --at 0 --lifetime 200 --lifetime-spread 50 --speed 26 --speed-spread 13 \
  --dir-y 1 --cone-angle 360 --seed 1
p set-forces --emitter flash --drag 4
p set-particle --emitter flash --size-curve ease-out --size-from 2.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#46d6e6@1"
p add-emitter --name vent --shape point --x 64 --y 64 \
  --burst 16 --at 0 --lifetime 480 --lifetime-spread 140 --speed 120 --speed-spread 50 \
  --dir-y 1 --cone-angle 360 --seed 12
p set-forces --emitter vent --radial 40 --drag 2.2
p set-particle --emitter vent --size-curve ease-out --size-from 0.5 --size-to 0.2 \
  --opacity-curve ease-out --opacity-from 0.9 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#eaffff@0,#46d6e6@1"
p add-emitter --name debris --shape point --x 64 --y 64 \
  --burst 22 --at 0 --lifetime 620 --lifetime-spread 180 --speed 150 --speed-spread 62 \
  --dir-y 1 --cone-angle 360 --seed 23
p set-forces --emitter debris --gravity 260 --drag 1.6
p set-particle --emitter debris --size-curve ease-out --size-from 0.6 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.08 \
  --color-gradient "#ffcf9a@0,#3a3d44@1"
p add-emitter --name alert --shape point --x 64 --y 64 \
  --burst 10 --at 0 --lifetime 320 --lifetime-spread 90 --speed 80 --speed-spread 44 \
  --dir-y 1 --cone-angle 360 --seed 30
p set-forces --emitter alert --drag 2.8
p set-particle --emitter alert --size-curve ease-out --size-from 0.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#ffffff@0,#ff5a52@1"
p set-timeline --loop false
p render
echo "produced death-burst.json"

echo "all underground particle systems produced under $FX"
