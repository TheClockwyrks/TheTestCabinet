#!/usr/bin/env bash
# Arc Foundry — author the ELECTRICAL VFX as particle SYSTEMS with the on-PATH `particle-2d`
# tool (specs/assets.md — "Particle systems … THE HEADLINE"). Every arc, spark shower,
# chain-lightning leap and discharge is a simulated system (emitters + forces + per-particle
# size/opacity/color curves), NOT baked frames: `render` emits a compact `system.json` the
# game plays LIVE via @test-cabinet/particle-runtime's ParticleCanvasPlayer (src/particles.ts).
#
# Ten systems land under assets/fx/, one per FxKind the game loads (src/assets.ts FX_SOURCE):
#   buildspark  a stamp lands hot — spark shower + arc snap (specs/build.md)
#   combine     two components combine — convergent implosion → payoff flash (specs/build.md)
#   arcbolt     a Capacitor / Discharge Rig fires its single bolt — blue-white crackle (towers.md)
#   chain       a Coil chains — forked violet lightning, dimming per jump (towers.md)
#   spray       an Emitter fires — fast fan of small teal sparks (towers.md)
#   ring        an Arc-Node shot lands — expanding ring of discharge over the splash (towers.md)
#   impact      any shot hits a unit — a small burst of sparks (towers.md)
#   death       a unit dies — an electrical pop; the Dynamo's is a big EMP (`big`) (enemies.md)
#   leak        a unit grounds out at the Collector — a red warning surge at the sink (flow.md)
#   muzzle      a firing head's muzzle glow — a small hot puff (welcome extra, assets.md)
#
# The quality-tier escalation is applied in code (particles.ts tierScale scales the burst),
# and the Dynamo's EMP via the `big` flag (2.2x) — so one authored system serves every tier.
# Re-run to regenerate. The *.actions.json / *.preview.gif scratch is written to a temp dir
# (never committed); only the finished system.json files under assets/fx/ are kept.
#
# Usage:  bash scripts/gen-fx.sh   (particle-2d must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
#
# Coordinate convention (from the tool + the runtime, per junction's verified notes): x
# across, y UP. The canvas player flips y up->down for the screen. `dir-y 1` launches UP;
# a POSITIVE `--gravity` accelerates DOWN on screen (sparks rain / flares slow as they
# rise). Field is 128x128, centered at (64,64) — the footprint each is scaled to on the
# board (src/particles.ts FOOTPRINT). Additive ("lighter") compositing means overlapping
# bright cores blow out to white-hot, so gradients run white-core -> saturated type colour.
set -euo pipefail

# Resolve the tool: prefer PATH, else the cargo target release dir.
if ! command -v particle-2d >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/particle-2d" ] || { echo "particle-2d not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FX="$ROOT/assets/fx"
mkdir -p "$FX"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# newfx <loop:true|false> <duration_ms> <out.system.json> : seed a fresh 128x128, 30fps
#   system whose emitted system.json lands at <out>. Preview/action scratch -> $TMP.
newfx() {
  printf '{ "width":128, "height":128, "duration_ms":%s, "fps":30, "loop":%s, "background":"transparent", "actions":"%s", "preview":"%s", "system":"%s" }\n' \
    "$2" "$1" "$TMP/actions.json" "$TMP/preview.gif" "$3" > "$CFG"
  particle-2d init --config "$CFG" >/dev/null
}
p() { particle-2d "$@" --config "$CFG" >/dev/null; }

# ============================ BUILD SPARK (stamp lands hot, one-shot) ==========
# The scrap-press stamps a component: a bright shower of hot sparks that arc up and rain
# down, a white flash at the footprint, and a snap of blue-white arc crackle. charge #ffcf4a
# hot sparks -> #ff9a46, arc core #eaf6ff -> capacitor blue #8fc4ff.
newfx false 760 "$FX/buildspark.system.json"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 7 --at 0 --lifetime 160 --lifetime-spread 40 --speed 22 --speed-spread 12 \
  --dir-y 1 --cone-angle 360 --seed 3
p set-forces --emitter flash --drag 5
p set-particle --emitter flash --size-curve ease-out --size-from 1.7 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffcf4a@1"
p add-emitter --name sparks --shape point --x 64 --y 64 \
  --burst 30 --at 0 --lifetime 540 --lifetime-spread 170 --speed 150 --speed-spread 62 \
  --dir-y 1 --cone-angle 360 --seed 11
p set-forces --emitter sparks --gravity 230 --drag 1.6
p set-particle --emitter sparks --size-curve ease-out --size-from 0.7 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.06 \
  --color-gradient "#ffffff@0,#ffcf4a@0.4,#ff9a46@1"
p add-emitter --name arc --shape point --x 64 --y 64 \
  --burst 11 --at 0 --lifetime 230 --lifetime-spread 60 --speed 74 --speed-spread 42 \
  --dir-y 1 --cone-angle 360 --seed 27
p set-forces --emitter arc --drag 3.0
p set-particle --emitter arc --size-curve ease-out --size-from 0.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.09 \
  --color-gradient "#eaf6ff@0,#8fc4ff@1"
p set-timeline --loop false
p render
echo "produced buildspark.system.json"

# ============================ COMBINE FLASH (implosion → payoff, one-shot) =====
# Two matching components combine one tier UP: a convergent implosion (particles rush INWARD
# on a negative radial) that collapses into a brilliant white->gold flash, then a bright
# outward payoff spray. primed violet #c78cff converging, tesla-gold #ffe45a payoff.
newfx false 980 "$FX/combine.system.json"
p add-emitter --name converge --shape disc --x 64 --y 64 --radius 30 \
  --burst 40 --at 0 --lifetime 420 --lifetime-spread 90 --speed 8 --speed-spread 5 \
  --dir-y 1 --cone-angle 360 --seed 5
p set-forces --emitter converge --radial -280 --drag 1.1
p set-particle --emitter converge --size-curve ease-in --size-from 0.9 --size-to 0.15 \
  --opacity-curve ease-in-out --opacity-from 0.85 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#c78cff@0,#eaf6ff@0.7,#ffe45a@1"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 12 --at 330 --lifetime 280 --lifetime-spread 60 --speed 32 --speed-spread 16 \
  --dir-y 1 --cone-angle 360 --seed 14
p set-forces --emitter flash --radial 50 --drag 4.0
p set-particle --emitter flash --size-curve ease-out --size-from 2.3 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffe45a@1"
p add-emitter --name payoff --shape point --x 64 --y 64 \
  --burst 28 --at 360 --lifetime 580 --lifetime-spread 170 --speed 175 --speed-spread 64 \
  --dir-y 1 --cone-angle 360 --seed 22
p set-forces --emitter payoff --radial 120 --gravity 130 --drag 1.8
p set-particle --emitter payoff --size-curve ease-out --size-from 0.7 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.06 \
  --color-gradient "#ffffff@0,#ffe45a@0.4,#c78cff@1"
p set-timeline --loop false
p render
echo "produced combine.system.json"

# ============================ ARC BOLT (single bolt, one-shot, fires often) ====
# A Capacitor / Discharge Rig unloads its single blue-white bolt: a hot core snap and a
# violent burst of stretched fork streaks with hard crackle. Short + cheap (fires often);
# the Discharge Rig scales it fatter via the tier scale + `big`. core #eaf6ff -> vent #4ac6ff.
newfx false 400 "$FX/arcbolt.system.json"
p add-emitter --name core --shape point --x 64 --y 64 \
  --burst 5 --at 0 --lifetime 150 --lifetime-spread 40 --speed 12 --speed-spread 7 \
  --dir-y 1 --cone-angle 360 --seed 2
p set-forces --emitter core --drag 5
p set-particle --emitter core --size-curve ease-out --size-from 1.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#eaf6ff@1"
p add-emitter --name forks --shape point --x 64 --y 64 \
  --burst 17 --at 0 --lifetime 270 --lifetime-spread 80 --speed 155 --speed-spread 78 \
  --dir-y 1 --cone-angle 360 --seed 9
p set-forces --emitter forks --drag 2.2
p set-particle --emitter forks --size-curve ease-out --size-from 0.55 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.13 \
  --color-gradient "#eaf6ff@0,#8fc4ff@0.5,#4ac6ff@1"
p add-emitter --name crackle --shape point --x 64 --y 64 \
  --burst 9 --at 0 --lifetime 190 --lifetime-spread 55 --speed 92 --speed-spread 52 \
  --dir-y 1 --cone-angle 360 --seed 18
p set-forces --emitter crackle --drag 3.0
p set-particle --emitter crackle --size-curve ease-out --size-from 0.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.06 \
  --color-gradient "#ffffff@0,#8fc4ff@1"
p set-timeline --loop false
p render
echo "produced arcbolt.system.json"

# ============================ CHAIN LIGHTNING (Coil chain, one-shot) ===========
# A Coil arcs and CHAINS between units: a violet core snap and a spray of long, uneven fork
# streaks (the wide speed spread reads as multiple leaps), dimming outward per jump. coil
# violet #b98cff, forking to deep #8a5cff.
newfx false 480 "$FX/chain.system.json"
p add-emitter --name core --shape point --x 64 --y 64 \
  --burst 6 --at 0 --lifetime 180 --lifetime-spread 45 --speed 14 --speed-spread 8 \
  --dir-y 1 --cone-angle 360 --seed 4
p set-forces --emitter core --drag 4
p set-particle --emitter core --size-curve ease-out --size-from 1.6 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#b98cff@1"
p add-emitter --name forks --shape point --x 64 --y 64 \
  --burst 24 --at 0 --lifetime 350 --lifetime-spread 100 --speed 160 --speed-spread 88 \
  --dir-y 1 --cone-angle 360 --seed 13
p set-forces --emitter forks --drag 2.0
p set-particle --emitter forks --size-curve ease-out --size-from 0.6 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.15 \
  --color-gradient "#eaf6ff@0,#b98cff@0.5,#8a5cff@1"
p add-emitter --name crackle --shape point --x 64 --y 64 \
  --burst 12 --at 0 --lifetime 250 --lifetime-spread 70 --speed 82 --speed-spread 48 \
  --dir-y 1 --cone-angle 360 --seed 26
p set-forces --emitter crackle --drag 3.0
p set-particle --emitter crackle --size-curve ease-out --size-from 0.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.06 \
  --color-gradient "#ffffff@0,#b98cff@1"
p set-timeline --loop false
p render
echo "produced chain.system.json"

# ============================ SPARK SPRAY (Emitter, one-shot, fires rapidly) ===
# The rapid anti-swarm Emitter: a fast fan of small teal sparks and a tiny pop. Very short +
# cheap because it fires constantly. emitter teal #7fe0c0.
newfx false 320 "$FX/spray.system.json"
p add-emitter --name pop --shape point --x 64 --y 64 \
  --burst 4 --at 0 --lifetime 120 --lifetime-spread 30 --speed 20 --speed-spread 10 \
  --dir-y 1 --cone-angle 360 --seed 7
p set-forces --emitter pop --drag 5
p set-particle --emitter pop --size-curve ease-out --size-from 1.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#7fe0c0@1"
p add-emitter --name sparks --shape point --x 64 --y 64 \
  --burst 16 --at 0 --lifetime 250 --lifetime-spread 75 --speed 172 --speed-spread 72 \
  --dir-y 1 --cone-angle 360 --seed 19
p set-forces --emitter sparks --gravity 95 --drag 2.4
p set-particle --emitter sparks --size-curve ease-out --size-from 0.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.1 \
  --color-gradient "#ffffff@0,#7fe0c0@0.4,#46d6c0@1"
p set-timeline --loop false
p render
echo "produced spray.system.json"

# ============================ DISCHARGE RING (Arc-Node lands, one-shot) ========
# An Arc-Node shot lands: an expanding RING of electrical discharge over its splash radius
# (uniform launch speed + tight spread makes a coherent shell), a hot core, and inner
# crackle. arc-node amber #ff9a46 -> discharge red #ff5470. The biggest footprint (78).
newfx false 640 "$FX/ring.system.json"
p add-emitter --name shell --shape point --x 64 --y 64 \
  --burst 46 --at 0 --lifetime 480 --lifetime-spread 40 --speed 150 --speed-spread 12 \
  --dir-y 1 --cone-angle 360 --seed 6
p set-forces --emitter shell --radial 60 --drag 0.8
p set-particle --emitter shell --size-curve ease-out --size-from 0.55 --size-to 0.2 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#ffffff@0,#ff9a46@0.5,#ff5470@1"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 9 --at 0 --lifetime 220 --lifetime-spread 55 --speed 26 --speed-spread 13 \
  --dir-y 1 --cone-angle 360 --seed 15
p set-forces --emitter flash --drag 4
p set-particle --emitter flash --size-curve ease-out --size-from 2.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffcf4a@1"
p add-emitter --name crackle --shape point --x 64 --y 64 \
  --burst 14 --at 0 --lifetime 300 --lifetime-spread 85 --speed 72 --speed-spread 44 \
  --dir-y 1 --cone-angle 360 --seed 24
p set-forces --emitter crackle --drag 2.5
p set-particle --emitter crackle --size-curve ease-out --size-from 0.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#eaf6ff@0,#ff9a46@1"
p set-timeline --loop false
p render
echo "produced ring.system.json"

# ============================ SPARK-BURST IMPACT (a shot hits, one-shot) =======
# Any projectile / arc connects with a unit: a small burst of blue sparks and a pin-flash.
# Tiny, cheap, fires very often. core #eaf6ff, sparks -> vent #4ac6ff.
newfx false 260 "$FX/impact.system.json"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 3 --at 0 --lifetime 110 --lifetime-spread 25 --speed 16 --speed-spread 8 \
  --dir-y 1 --cone-angle 360 --seed 8
p set-forces --emitter flash --drag 5
p set-particle --emitter flash --size-curve ease-out --size-from 1.1 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#eaf6ff@1"
p add-emitter --name sparks --shape point --x 64 --y 64 \
  --burst 12 --at 0 --lifetime 210 --lifetime-spread 65 --speed 132 --speed-spread 62 \
  --dir-y 1 --cone-angle 360 --seed 20
p set-forces --emitter sparks --gravity 120 --drag 2.6
p set-particle --emitter sparks --size-curve ease-out --size-from 0.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.09 \
  --color-gradient "#ffffff@0,#8fc4ff@0.5,#4ac6ff@1"
p set-timeline --loop false
p render
echo "produced impact.system.json"

# ============================ DISCHARGE / DEATH BURST (a unit dies, one-shot) ==
# A unit grounds its charge as it dies: an electrical pop — a flash, an outward spark shell,
# and an EMP shock ring. The Dynamo boss reuses this scaled up via the `big` flag (2.2x),
# where the EMP ring reads huge. load grey #c4cbd6, vent #4ac6ff, dynamo violet #a45cff.
newfx false 640 "$FX/death.system.json"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 8 --at 0 --lifetime 200 --lifetime-spread 50 --speed 26 --speed-spread 13 \
  --dir-y 1 --cone-angle 360 --seed 1
p set-forces --emitter flash --drag 4
p set-particle --emitter flash --size-curve ease-out --size-from 2.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#4ac6ff@1"
p add-emitter --name shell --shape point --x 64 --y 64 \
  --burst 30 --at 0 --lifetime 480 --lifetime-spread 130 --speed 150 --speed-spread 64 \
  --dir-y 1 --cone-angle 360 --seed 12
p set-forces --emitter shell --radial 40 --gravity 80 --drag 1.8
p set-particle --emitter shell --size-curve ease-out --size-from 0.7 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.07 \
  --color-gradient "#ffffff@0,#c4cbd6@0.35,#4ac6ff@1"
p add-emitter --name emp --shape point --x 64 --y 64 \
  --burst 18 --at 0 --lifetime 420 --lifetime-spread 30 --speed 120 --speed-spread 14 \
  --dir-y 1 --cone-angle 360 --seed 23
p set-forces --emitter emp --radial 50 --drag 1.0
p set-particle --emitter emp --size-curve ease-out --size-from 0.5 --size-to 0.2 \
  --opacity-curve ease-out --opacity-from 0.95 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#eaf6ff@0,#a45cff@1"
p add-emitter --name crackle --shape point --x 64 --y 64 \
  --burst 10 --at 0 --lifetime 260 --lifetime-spread 70 --speed 82 --speed-spread 46 \
  --dir-y 1 --cone-angle 360 --seed 31
p set-forces --emitter crackle --drag 3.0
p set-particle --emitter crackle --size-curve ease-out --size-from 0.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#ffffff@0,#a45cff@1"
p set-timeline --loop false
p render
echo "produced death.system.json"

# ============================ LEAK ALARM (unit grounds out, one-shot) ==========
# A unit reaches the Collector and dumps its charge — Grid Integrity drops. A red danger
# read at the sink: a rising warning flare, an alarm shock ring, a hot flash, and falling
# embers. charge #ffcf4a -> alert red #ff5a52 / discharge #ff5470.
newfx false 840 "$FX/leak.system.json"
p add-emitter --name flare --shape point --x 64 --y 82 \
  --burst 24 --at 0 --lifetime 620 --lifetime-spread 170 --speed 122 --speed-spread 52 \
  --dir-y 1 --cone-angle 55 --seed 10
p set-forces --emitter flare --gravity 32 --drag 2.0
p set-particle --emitter flare --size-curve ease-out --size-from 0.7 --size-to 0.1 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.08 \
  --color-gradient "#ffcf4a@0,#ff5a52@0.5,#ff5470@1"
p add-emitter --name ring --shape point --x 64 --y 64 \
  --burst 20 --at 0 --lifetime 500 --lifetime-spread 36 --speed 132 --speed-spread 16 \
  --dir-y 1 --cone-angle 360 --seed 17
p set-forces --emitter ring --radial 50 --drag 1.0
p set-particle --emitter ring --size-curve ease-out --size-from 0.5 --size-to 0.2 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#ffffff@0,#ff5a52@1"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 8 --at 0 --lifetime 240 --lifetime-spread 60 --speed 30 --speed-spread 15 \
  --dir-y 1 --cone-angle 360 --seed 28
p set-forces --emitter flash --drag 4
p set-particle --emitter flash --size-curve ease-out --size-from 2.2 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ff5a52@1"
p add-emitter --name embers --shape point --x 64 --y 68 \
  --burst 14 --at 0 --lifetime 700 --lifetime-spread 200 --speed 62 --speed-spread 32 \
  --dir-y 1 --cone-angle 360 --seed 33
p set-forces --emitter embers --gravity 95 --drag 1.6
p set-particle --emitter embers --size-curve ease-out --size-from 0.45 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.05 \
  --color-gradient "#ff9a46@0,#ff5470@1"
p set-timeline --loop false
p render
echo "produced leak.system.json"

# ============================ MUZZLE GLOW (firing head, one-shot, fires often) =
# A small hot glow at a firing head's muzzle — a welcome ambience extra (assets.md). Tiny +
# cheap. core #ffffff -> capacitor blue #8fc4ff, a couple of vent-blue sparks.
newfx false 220 "$FX/muzzle.system.json"
p add-emitter --name glow --shape point --x 64 --y 64 \
  --burst 5 --at 0 --lifetime 170 --lifetime-spread 40 --speed 18 --speed-spread 10 \
  --dir-y 1 --cone-angle 360 --seed 25
p set-forces --emitter glow --drag 4
p set-particle --emitter glow --size-curve ease-out --size-from 1.6 --size-to 0.2 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#8fc4ff@1"
p add-emitter --name spark --shape point --x 64 --y 64 \
  --burst 4 --at 0 --lifetime 140 --lifetime-spread 40 --speed 62 --speed-spread 32 \
  --dir-y 1 --cone-angle 360 --seed 30
p set-forces --emitter spark --drag 3
p set-particle --emitter spark --size-curve ease-out --size-from 0.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.08 \
  --color-gradient "#eaf6ff@0,#4ac6ff@1"
p set-timeline --loop false
p render
echo "produced muzzle.system.json"

echo "all electrical particle systems produced under $FX"
