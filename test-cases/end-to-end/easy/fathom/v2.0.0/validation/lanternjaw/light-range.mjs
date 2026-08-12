// lanternjaw.light-range: the Lanternjaw fixes on the forager within its light range
// and line of sight; the reported range follows R = 128 + 192 G.
//
// The lit sight line is posed instantly (`arrange`); the fix it produces takes the real
// sim, so it is `act` and is what the clip shows.
import {
  denAllExcept,
  findSightLine,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let p;

  return {
    id: "lanternjaw.light-range",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 3); // 96 px apart, clear line of sight
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setPredator", "lanternjaw", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      await quietBoard(api, line.forager);
      await api.call("setBrightness", 1); // R = 320 px, well past the 96 px gap
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      p = pred(await api.snapshot(), "lanternjaw");
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      check.expectEq(
        "the Lanternjaw fixes on the forager within range and LOS (drops its disguise)",
        p.state,
        "chase",
      );
      check.expectClose(
        "the detection range follows 128 + 192 G",
        p.detectRange,
        320,
        24,
      );
    },
  };
}
