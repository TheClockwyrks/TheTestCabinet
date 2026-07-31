// lanternjaw.ink-shakes: ink between the Lanternjaw and the forager breaks its fix.
//
// The close, lit sight line is posed instantly (`arrange`); the fix, the ink drop and the
// broken fix are the real sim, so they are `act` and are what the clip shows.
import {
  denAllExcept,
  findSightLine,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let fixed;
  let afterInk;

  return {
    id: "lanternjaw.ink-shakes",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 2); // close, so ink at the forager covers the line
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setPredator", "lanternjaw", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      await quietBoard(api, line.forager);
      await api.call("setBrightness", 1);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      fixed = pred(await api.snapshot(), "lanternjaw").state;
      await api.call("clearCooldowns");
      await api.call("press", "ShiftLeft"); // drop ink at the forager
      await api.advance(24); // 24 ticks = the old 0.2 s
      afterInk = pred(await api.snapshot(), "lanternjaw").state;
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq(
        "the Lanternjaw is fixed on the forager first",
        fixed,
        "chase",
      );
      check.expectEq(
        "ink between them breaks the Lanternjaw's fix",
        afterInk,
        "wander",
      );
    },
  };
}
