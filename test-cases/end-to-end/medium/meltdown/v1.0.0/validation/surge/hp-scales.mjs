// Automated validation for the Surge sub-item `hp-scales`.
//
// A unit's HP scales up with the wave number (specs/gameplay.md — +62% per wave over
// wave 1), so a deep-wave unit is far tankier. A Mote is 40 HP at wave 1; at wave 6
// it is 40 * (1 + 0.62*5) = 164. We spawn a Mote on wave 1 and on wave 6 and compare.
//
// The wave has to be RUNNING for the unit to belong to it. `setWave(n)` "rebuilds the
// run to wave `n`'s build phase" (specs/instrumentation.md), and a build may land on
// wave `n` directly or in the phase ahead of it with the counter still at `n - 1`. Both
// are conformant, so the wave is released only if the pose has not already arrived, and
// the expectation is computed from the wave the snapshot actually reports rather than
// hardcoded, so the two cannot drift apart.
//
// A CLIP OF THE DIFFERENCE, NOT A STILL OF A NUMBER.
//
// The numbers are read instantly off the two Motes, so the verdict costs no time and the
// readings live in `arrange`. What a still could then show was one deep-wave unit with a
// health bar, which says nothing — a full bar looks the same at 40 HP and at 164, and
// the value it has to be compared against is in a frame the reviewer does not have.
//
// So what is FILMED is the same emitter, at the same heat, shooting one then the other.
// The wave-1 Mote comes apart in a couple of shots; the wave-6 Mote takes the same shots
// and keeps walking, its bar creeping down. That is what "scales with the wave" means in
// play, and it is legible without reading a single number.
//
// The Arc stands at the gate so it engages both Motes whatever route the build walks
// them on (see the note above `buildGate` in `_helpers`); an emitter aimed at an assumed
// lane would film two Motes strolling past untouched.

import {
  newGame,
  buildGate,
  spawn,
  unit,
  actTail,
  GATE_WALLS,
  TICK,
} from "../_helpers.mjs";

// specs/gameplay.md: a unit's HP is its base HP times `1 + 0.62 * (w - 1)`.
const BASE_MOTE_HP = 40;
const scaledHp = (wave) => BASE_MOTE_HP * (1 + 0.62 * (wave - 1));

// The deep wave compared against wave 1. Six is far enough to be unmistakable (4.1x)
// and shallow enough that the Arc still visibly grinds the unit down inside a clip.
const DEEP_WAVE = 6;

// Hot enough to do real damage, so the wave-1 Mote dies quickly and the difference
// between the two is a matter of seconds rather than of arithmetic.
const ARC_HEAT = 80;

/**
 * Pose the run so that `wave` is the one RUNNING, spawn a Mote into it, and read it back
 * alongside the wave the game says it is on. Consumes no time.
 *
 * Where `setWave(n)` leaves the counter is read back rather than assumed: the spec admits
 * landing on wave `n` directly or in the build phase ahead of it, so the wave is released
 * only if the pose has not already arrived, and the caller asserts it landed where it
 * wanted. Hardcoding either reading fails half of the conformant builds.
 */
async function spawnOnWave(api, wave) {
  await api.call("setWave", wave);
  if ((await api.snapshot()).wave !== wave) await api.call("startWave");
  const id = await spawn(api, "mote", "left");
  return { wave: (await api.snapshot()).wave, id, mote: await unit(api, id) };
}

export default function item() {
  let walls;
  let w1;
  let w6;

  return {
    id: "surge.hp-scales",

    // Two grindings, back to back, each a few seconds on a conformant build.
    clipMs: 12000,

    // Both Motes are spawned and read here — the scaling is applied at spawn and the
    // reads are instant, so the verdict is settled before a frame is filmed. The wave-1
    // Mote is then killed off in `act` before the deep one is released, so the clip
    // holds one unit at a time.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 1000000);
      const gate = await buildGate(api, "arc");
      walls = gate.walls;
      await api.call("setHeat", gate.id, ARC_HEAT);
      w1 = await spawnOnWave(api, 1);
    },

    // The filmed half: the wave-1 Mote is ground down and dies, then a wave-6 Mote takes
    // the same fire and keeps coming.
    async act(api) {
      // 600 ticks = a 10 s cap; polling every tick stops on the frame the Mote goes.
      await api.until((s) => !s.surge.some((u) => u.id === w1.id), {
        max: 600,
        poll: TICK,
      });
      await actTail(api, 60); // a beat on the empty floor, so the two do not run together

      w6 = await spawnOnWave(api, DEEP_WAVE);
      // Not run to a kill: the point is that this one does NOT come apart on the same
      // shots. Four seconds of it absorbing them and walking on is the comparison.
      await actTail(api, 240);
    },

    async assert(api, check) {
      // A hole in the gate lets the Motes walk round the Arc, and the clip would then
      // show two untouched units rather than a contrast.
      check.expectEq("the gate wall was built", walls, GATE_WALLS);

      // Guard the premise: if the wave was not actually posed, the HP readings below
      // are about some other wave and their labels would be misleading.
      check.expectEq("the run was posed on wave 1", w1.wave, 1);
      check.expectEq(
        `the run was posed on wave ${DEEP_WAVE}`,
        w6.wave,
        DEEP_WAVE,
      );

      check.expectClose(
        `a wave-${w1.wave} Mote has base HP (${scaledHp(w1.wave)})`,
        w1.mote.maxHp,
        scaledHp(w1.wave),
        0.5,
      );
      check.expectClose(
        `a wave-${w6.wave} Mote has scaled HP (${scaledHp(w6.wave)})`,
        w6.mote.maxHp,
        scaledHp(w6.wave),
        0.5,
      );
      check.expectGt(
        "HP scales up with the wave",
        w6.mote.maxHp,
        w1.mote.maxHp,
      );
    },
  };
}
