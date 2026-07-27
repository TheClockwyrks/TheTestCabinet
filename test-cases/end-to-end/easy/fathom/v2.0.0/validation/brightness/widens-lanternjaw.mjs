// brightness.widens-lanternjaw: a higher G widens the Lanternjaw's detection range.
//
// The board is posed in `arrange`; the two brightness settings and the moment each
// needs to take effect in the sim are `act`, so the clip shows the range being read at
// a low G and then at a high one.
import {
  denAllExcept,
  findOpenWithNeighbor,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let low;
  let high;

  return {
    id: "brightness.widens-lanternjaw",

    async arrange(api) {
      const snap = await startPlaying(api);
      const spot = findOpenWithNeighbor(snap, "right");
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setPredator", "lanternjaw", {
        tx: spot.tx,
        ty: spot.ty,
        mode: "wander",
      });
      // Clear the board (all but one pellet, placed adjacent to the stationary forager)
      // so the forager cannot eat and bump its own brightness while we read the range.
      await quietBoard(api);
    },

    async act(api) {
      // Each `advance(2)` is the old step(0.02) = 2.4 ticks, which the contract refuses
      // to round. These are "let the setting take effect" beats rather than measured
      // durations, so 2 ticks is the faithful whole-tick choice.
      await api.call("setBrightness", 0.1);
      await api.advance(2);
      low = pred(await api.snapshot(), "lanternjaw").detectRange;
      await api.call("setBrightness", 0.9);
      await api.advance(2);
      high = pred(await api.snapshot(), "lanternjaw").detectRange;
      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectGt(
        "higher brightness widens the Lanternjaw's detection range",
        high,
        low,
      );
      check.expectClose("range at low G (128 + 192*0.1)", low, 147, 18);
      check.expectClose("range at high G (128 + 192*0.9)", high, 301, 24);
    },
  };
}
