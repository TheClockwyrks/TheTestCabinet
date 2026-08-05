// Automated validation for the Rime sub-item `degrades-with-heat`.
//
// The Rime's slow fraction falls as it heats, degrading to nothing at the trip — it
// runs the heat rule backward (specs/heat.md). Two readings of that, and they are
// deliberately different in kind:
//
//   * THE CURVE, posed. Heat is set across the whole range and the slow fraction the
//     game reports is read at each stop. That is exact — it pins the 0.55 ceiling at
//     `H = 0` and the ~0 floor at the trip, and it is monotone in between — and it
//     costs no time at all, so it lives in `arrange` alongside the rest of the pose.
//   * THE DEGRADATION, real. The same Rime, cold, with the surge walking into it: its
//     own firing warms it and the slow fades in front of the reviewer. That is what the
//     clip is, and it carries its own assertion — the live slow really did fall as the
//     live heat rose — so the filmed half is evidence rather than decoration.
//
// A CLIP RATHER THAN A STILL, because the claim is a relationship between two moving
// numbers. A screenshot of a Rime reading some slow percentage at some heat says
// nothing: the value it has to be compared against is in a frame the reviewer does not
// have, and a build that reports a constant slow looks identical. It does not need to
// run all the way to the trip — a few shots' worth of self-heating is enough to watch
// the number come down.
//
// The Rime is SELECTED, because the slow percentage is an inspector read: "the
// heat-averse Rime shows its live slow percentage in place of a damage read"
// (specs/controls.md). Without the selection the clip shows a tower shooting and none of
// the numbers the item is about.
//
// It stands at the gate so it has something to fire at whatever route the build walks
// its surge on (see the note above `buildGate` in `_helpers`) — a Rime with nothing in
// range never warms, and the live half would read a flat line on a working build.

import { newGame, buildGate, spawn, tower, GATE_WALLS } from "../_helpers.mjs";

// The posed curve: the whole range, ceiling to trip.
const HEATS = [0, 25, 50, 75, 100];

// The live drive: how long the Rime is left firing, sampled in beats. Six beats of 45
// ticks is 4.5 s — a handful of shots at the Rime's 2.4/s, which is plenty to move a
// slow that falls by `slowCeil / 100` per point of heat.
const BEAT = 45;
const BEATS = 6;

export default function item() {
  let rimeId;
  let walls;
  const slows = [];
  const live = [];

  return {
    id: "rime.degrades-with-heat",

    clipMs: 8000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const gate = await buildGate(api, "rime");
      rimeId = gate.id;
      walls = gate.walls;

      // The posed curve. `setHeat` and `snapshot` consume no time, so the exact
      // readings belong here — and taking them before the drive keeps the clip free of
      // a heat bar teleporting up and down the scale.
      for (const h of HEATS) {
        await api.call("setHeat", rimeId, h);
        slows.push((await tower(api, rimeId)).slowFactor);
      }

      // Now set up the live half: cold, selected, with the surge on its way.
      await api.call("setHeat", rimeId, 0);
      await api.call("selectTower", rimeId);
      for (let i = 0; i < 6; i += 1) await spawn(api, "mote", "left");
    },

    // The filmed half: the Rime firing on the stream, warming itself, and its slow
    // percentage coming down as it does.
    async act(api) {
      for (let i = 0; i < BEATS; i += 1) {
        const t = await tower(api, rimeId);
        live.push({ heat: t.heat, slow: t.slowFactor });
        await api.advance(BEAT);
      }
      const t = await tower(api, rimeId);
      live.push({ heat: t.heat, slow: t.slowFactor });
    },

    async assert(api, check) {
      // A hole in the gate lets the Motes walk round the Rime, and a slow that never
      // moved would then be about the scenery rather than about the heat.
      check.expectEq("the gate wall was built", walls, GATE_WALLS);

      // The posed curve.
      check.expectClose(
        "a cold Rime slows at its full ceiling",
        slows[0],
        0.55,
        0.02,
      );
      check.expectClose("a fully-hot Rime no longer slows", slows[4], 0, 0.01);
      for (let i = 1; i < slows.length; i += 1) {
        check.expectLt(
          `the slow at heat ${HEATS[i]} is weaker than at ${HEATS[i - 1]}`,
          slows[i],
          slows[i - 1],
        );
      }

      // The live drive, which is what the clip shows. The Rime has to have warmed
      // itself for the reading to mean anything — a Rime that never fired holds both
      // numbers still, and "the slow did not rise" would be true of it.
      const first = live[0];
      const last = live[live.length - 1];
      check.expectGt(
        "the Rime's own firing warmed it",
        last.heat,
        first.heat + 1,
      );
      check.expectLt(
        `and its live slow fell as it did (${first.slow.toFixed(3)} -> ${last.slow.toFixed(3)})`,
        last.slow,
        first.slow,
      );
    },
  };
}
