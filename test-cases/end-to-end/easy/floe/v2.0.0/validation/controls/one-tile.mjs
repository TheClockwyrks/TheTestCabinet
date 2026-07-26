// Automated validation for the Controls item `one-tile`.
//
// A single press moves exactly one tile — even if the simulation then runs for a
// while — because a tap is consumed once. A held direction key, by contrast,
// auto-repeats hops at the hop cooldown. Both are driven with real injected input
// down the game's own play code. See validation/_helpers.mjs.

import { hopPocket, ICE_TOP } from "../_helpers.mjs";

// 0.6 s at 120 Hz: long enough that a tap has plainly stopped moving while a held
// key has had time for several cooldowns' worth of hops.
const SPAN_TICKS = 72;

export default function item() {
  // The critter either side of the tap, and either side of the held run.
  let b1;
  let a1;
  let b2;
  let a2;

  return {
    id: "controls.one-tile",

    // Pose the safe pocket: every direction lands on a solid, hazard-free tile, so
    // the hop count reads only what the input produced.
    async arrange(api) {
      await hopPocket(api);
    },

    // A tap, then the same span with the key held. The re-pose between them is
    // `placeCritter` alone rather than another `hopPocket` — that helper leads with
    // `startCrossing`, whose reset would take the clock back mid-`act` and freeze the
    // recording; the pocket's cleared lanes survive, so a re-place restores it.
    async act(api) {
      // A single press moves exactly one tile, even across a long span.
      b1 = (await api.snapshot()).critter;
      await api.call("press", "ArrowLeft");
      await api.advance(SPAN_TICKS);
      a1 = (await api.snapshot()).critter;

      // A held key auto-repeats several hops over the same span.
      await api.call("placeCritter", 20, ICE_TOP);
      b2 = (await api.snapshot()).critter;
      await api.call("keyDown", "ArrowLeft");
      await api.advance(SPAN_TICKS);
      await api.call("keyUp", "ArrowLeft");
      a2 = (await api.snapshot()).critter;
    },

    async assert(api, check) {
      check.expectEq(
        "a single press moves exactly one tile",
        b1.col - a1.col,
        1,
      );
      check.expectGt(
        "a held key auto-repeats more than one hop",
        b2.col - a2.col,
        1,
      );
    },
  };
}
